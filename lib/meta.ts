/**
 * Meta Messaging API — send replies to Facebook Messenger and Instagram DMs.
 *
 * Usage:
 *   sendMetaReply('page', recipientPsid, 'Hello!');     // Facebook Messenger
 *   sendMetaReply('instagram', recipientIgsid, 'Hi!', igUserId);  // Instagram DM
 */

const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;

interface MetaReplyResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a reply via Facebook Messenger or Instagram DMs.
 *
 * @param platform 'page' for Messenger, 'instagram' for Instagram DMs
 * @param recipientId The sender's platform-scoped ID (PSID for Messenger, IGSID for Instagram)
 * @param text The reply message text
 * @param igUserId For Instagram only — the IG User ID to send from (required for IG)
 */
export async function sendMetaReply(
  platform: 'page' | 'instagram',
  recipientId: string,
  text: string,
  igUserId?: string
): Promise<MetaReplyResult> {
  if (!PAGE_ACCESS_TOKEN) {
    return { success: false, error: 'META_PAGE_ACCESS_TOKEN not configured' };
  }

  // Truncate to Meta's limit (2000 chars for Messenger, 1000 for Instagram)
  const maxLength = platform === 'instagram' ? 1000 : 2000;
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;

  // Build the API URL
  // Messenger: POST /me/messages
  // Instagram: POST /<IG_USER_ID>/messages
  const endpoint = platform === 'instagram' && igUserId
    ? `https://graph.facebook.com/v21.0/${igUserId}/messages`
    : 'https://graph.facebook.com/v21.0/me/messages';

  const body: any = {
    recipient: { id: recipientId },
    message: { text: truncatedText },
  };

  // Messenger requires messaging_type
  if (platform === 'page') {
    body.messaging_type = 'RESPONSE';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (result.error) {
      return {
        success: false,
        error: `Meta API error ${result.error.code}: ${result.error.message}`,
      };
    }

    return {
      success: true,
      messageId: result.message_id,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Network error: ${error.message}`,
    };
  }
}

/**
 * Send an image reply (for both Messenger and Instagram).
 */
export async function sendMetaImage(
  platform: 'page' | 'instagram',
  recipientId: string,
  imageUrl: string,
  igUserId?: string
): Promise<MetaReplyResult> {
  if (!PAGE_ACCESS_TOKEN) {
    return { success: false, error: 'META_PAGE_ACCESS_TOKEN not configured' };
  }

  const endpoint = platform === 'instagram' && igUserId
    ? `https://graph.facebook.com/v21.0/${igUserId}/messages`
    : 'https://graph.facebook.com/v21.0/me/messages';

  const body: any = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: 'image',
        payload: { url: imageUrl, is_reusable: true },
      },
    },
  };

  if (platform === 'page') {
    body.messaging_type = 'RESPONSE';
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json();

    if (result.error) {
      return { success: false, error: `Meta API error: ${result.error.message}` };
    }

    return { success: true, messageId: result.message_id };
  } catch (error: any) {
    return { success: false, error: `Network error: ${error.message}` };
  }
}
