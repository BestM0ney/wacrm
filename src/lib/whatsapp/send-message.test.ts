import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

/**
 * A db that serves one conversation with the given contact, and has no
 * whatsapp_config. Recipient resolution runs BEFORE the config lookup,
 * so "WhatsApp not configured" is the signal that a recipient was
 * accepted — anything rejected fails earlier with its own message.
 */
function dbWithContact(contact: Record<string, unknown>): SupabaseClient {
  const chain = (result: unknown) => {
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      single: async () => result,
      maybeSingle: async () => result,
    };
    return api;
  };
  return {
    from(table: string) {
      if (table === 'conversations') {
        return chain({ data: { id: 'cv-1', contact }, error: null });
      }
      return chain({ data: null, error: { message: 'not found' } });
    },
  } as unknown as SupabaseClient;
}

describe('sendMessageToConversation — recipient resolution', () => {
  const params: SendMessageParams = {
    conversationId: 'cv-1',
    messageType: 'text',
    contentText: 'hola',
  };

  it('accepts a contact that has only a wa_id (WhatsApp username sender)', async () => {
    // The regression this guards: a customer who reaches us through a
    // username has no dialable number, and the send used to abort with
    // "Contact phone number not found" — leaving them unanswerable.
    const db = dbWithContact({ id: 'c-1', phone: '', wa_id: 'u.diego.garrido' });
    await expect(
      sendMessageToConversation(db, 'acct-1', params)
    ).rejects.toThrow(/WhatsApp not configured/);
  });

  it('still prefers a usable phone number when the contact has one', async () => {
    const db = dbWithContact({
      id: 'c-2',
      phone: '+57 300 1234567',
      wa_id: '573001234567',
    });
    await expect(
      sendMessageToConversation(db, 'acct-1', params)
    ).rejects.toThrow(/WhatsApp not configured/);
  });

  it('rejects a contact with neither a phone nor a wa_id', async () => {
    const db = dbWithContact({ id: 'c-3', phone: '', wa_id: null });
    await expect(
      sendMessageToConversation(db, 'acct-1', params)
    ).rejects.toThrow(/no phone number or WhatsApp ID/);
  });

  it('rejects a malformed phone when there is no wa_id to fall back on', async () => {
    const db = dbWithContact({ id: 'c-4', phone: '12', wa_id: null });
    await expect(
      sendMessageToConversation(db, 'acct-1', params)
    ).rejects.toThrow(/Invalid phone number format/);
  });
});

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});
