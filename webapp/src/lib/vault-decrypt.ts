import { base64ToBytes, decryptBw, decryptStr } from './crypto';
import { deriveSendKeyParts } from './app-support';
import type { Cipher, Folder, Send } from './types';

export interface DecryptVaultCoreArgs {
  folders: Folder[];
  ciphers: Cipher[];
  symEncKeyB64: string;
  symMacKeyB64: string;
}

export interface DecryptVaultCoreResult {
  folders: Folder[];
  ciphers: Cipher[];
}

export interface DecryptSendsArgs {
  sends: Send[];
  symEncKeyB64: string;
  symMacKeyB64: string;
  origin: string;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function decryptField(
  value: string | null | undefined,
  enc: Uint8Array,
  mac: Uint8Array
): Promise<string> {
  if (!value || typeof value !== 'string') return '';
  try {
    return await decryptStr(value, enc, mac);
  } catch {
    return value;
  }
}

async function decryptFieldWithSource(
  value: string | null | undefined,
  itemEnc: Uint8Array,
  itemMac: Uint8Array,
  userEnc: Uint8Array,
  userMac: Uint8Array,
  canFallbackToUserKey: boolean
): Promise<{ text: string; source: 'item' | 'user' | 'plain' }> {
  const raw = String(value || '').trim();
  if (!raw) return { text: '', source: 'plain' };
  try {
    return { text: await decryptStr(raw, itemEnc, itemMac), source: 'item' };
  } catch {
    // Try legacy user-key fallback below.
  }
  if (canFallbackToUserKey) {
    try {
      return { text: await decryptStr(raw, userEnc, userMac), source: 'user' };
    } catch {
      // Keep plain fallback.
    }
  }
  return { text: raw, source: 'plain' };
}

export async function decryptVaultCore(args: DecryptVaultCoreArgs): Promise<DecryptVaultCoreResult> {
  const userEnc = base64ToBytes(args.symEncKeyB64);
  const userMac = base64ToBytes(args.symMacKeyB64);

  const folders = await Promise.all(
    args.folders.map(async (folder) => ({
      ...folder,
      decName: await decryptField(folder.name, userEnc, userMac),
    }))
  );

  const ciphers = await Promise.all(
    args.ciphers.map(async (cipher) => {
      let itemEnc = userEnc;
      let itemMac = userMac;
      if (cipher.key) {
        try {
          const itemKey = await decryptBw(cipher.key, userEnc, userMac);
          itemEnc = itemKey.slice(0, 32);
          itemMac = itemKey.slice(32, 64);
        } catch {
          // Keep user key fallback.
        }
      }
      const itemUsesUserKey = sameBytes(itemEnc, userEnc) && sameBytes(itemMac, userMac);
      const nextCipher: Cipher = {
        ...cipher,
        decName: await decryptField(cipher.name || '', itemEnc, itemMac),
        decNotes: await decryptField(cipher.notes || '', itemEnc, itemMac),
      };

      if (cipher.login) {
        nextCipher.login = {
          ...cipher.login,
          decUsername: await decryptField(cipher.login.username || '', itemEnc, itemMac),
          decPassword: await decryptField(cipher.login.password || '', itemEnc, itemMac),
          decTotp: await decryptField(cipher.login.totp || '', itemEnc, itemMac),
          uris: await Promise.all(
            (cipher.login.uris || []).map(async (uri) => ({
              ...uri,
              decUri: await decryptField(uri.uri || '', itemEnc, itemMac),
            }))
          ),
        };
      }

      if (Array.isArray(cipher.passwordHistory)) {
        nextCipher.passwordHistory = await Promise.all(
          cipher.passwordHistory.map(async (entry) => ({
            ...entry,
            decPassword: await decryptField(entry?.password || '', itemEnc, itemMac),
          }))
        );
      }

      if (cipher.card) {
        nextCipher.card = {
          ...cipher.card,
          decCardholderName: await decryptField(cipher.card.cardholderName || '', itemEnc, itemMac),
          decNumber: await decryptField(cipher.card.number || '', itemEnc, itemMac),
          decBrand: await decryptField(cipher.card.brand || '', itemEnc, itemMac),
          decExpMonth: await decryptField(cipher.card.expMonth || '', itemEnc, itemMac),
          decExpYear: await decryptField(cipher.card.expYear || '', itemEnc, itemMac),
          decCode: await decryptField(cipher.card.code || '', itemEnc, itemMac),
        };
      }

      if (cipher.identity) {
        nextCipher.identity = {
          ...cipher.identity,
          decTitle: await decryptField(cipher.identity.title || '', itemEnc, itemMac),
          decFirstName: await decryptField(cipher.identity.firstName || '', itemEnc, itemMac),
          decMiddleName: await decryptField(cipher.identity.middleName || '', itemEnc, itemMac),
          decLastName: await decryptField(cipher.identity.lastName || '', itemEnc, itemMac),
          decUsername: await decryptField(cipher.identity.username || '', itemEnc, itemMac),
          decCompany: await decryptField(cipher.identity.company || '', itemEnc, itemMac),
          decSsn: await decryptField(cipher.identity.ssn || '', itemEnc, itemMac),
          decPassportNumber: await decryptField(cipher.identity.passportNumber || '', itemEnc, itemMac),
          decLicenseNumber: await decryptField(cipher.identity.licenseNumber || '', itemEnc, itemMac),
          decEmail: await decryptField(cipher.identity.email || '', itemEnc, itemMac),
          decPhone: await decryptField(cipher.identity.phone || '', itemEnc, itemMac),
          decAddress1: await decryptField(cipher.identity.address1 || '', itemEnc, itemMac),
          decAddress2: await decryptField(cipher.identity.address2 || '', itemEnc, itemMac),
          decAddress3: await decryptField(cipher.identity.address3 || '', itemEnc, itemMac),
          decCity: await decryptField(cipher.identity.city || '', itemEnc, itemMac),
          decState: await decryptField(cipher.identity.state || '', itemEnc, itemMac),
          decPostalCode: await decryptField(cipher.identity.postalCode || '', itemEnc, itemMac),
          decCountry: await decryptField(cipher.identity.country || '', itemEnc, itemMac),
        };
      }

      if (cipher.sshKey) {
        const encryptedFingerprint = cipher.sshKey.keyFingerprint || cipher.sshKey.fingerprint || '';
        nextCipher.sshKey = {
          ...cipher.sshKey,
          decPrivateKey: await decryptField(cipher.sshKey.privateKey || '', itemEnc, itemMac),
          decPublicKey: await decryptField(cipher.sshKey.publicKey || '', itemEnc, itemMac),
          keyFingerprint: encryptedFingerprint || null,
          fingerprint: encryptedFingerprint || null,
          decFingerprint: await decryptField(encryptedFingerprint, itemEnc, itemMac),
        };
      }

      if (cipher.fields) {
        nextCipher.fields = await Promise.all(
          cipher.fields.map(async (field) => ({
            ...field,
            decName: await decryptField(field.name || '', itemEnc, itemMac),
            decValue: await decryptField(field.value || '', itemEnc, itemMac),
          }))
        );
      }

      if (Array.isArray(cipher.attachments)) {
        nextCipher.attachments = await Promise.all(
          cipher.attachments.map(async (attachment) => {
            const fileNameResult = await decryptFieldWithSource(
              attachment.fileName || '',
              itemEnc,
              itemMac,
              userEnc,
              userMac,
              !itemUsesUserKey
            );
            return {
              ...attachment,
              decFileName: fileNameResult.text,
            };
          })
        );
      }

      return nextCipher;
    })
  );

  return { folders, ciphers };
}

export async function decryptSends(args: DecryptSendsArgs): Promise<Send[]> {
  const userEnc = base64ToBytes(args.symEncKeyB64);
  const userMac = base64ToBytes(args.symMacKeyB64);
  return Promise.all(
    args.sends.map(async (send) => {
      const nextSend: Send = { ...send };
      try {
        if (send.key) {
          const sendKeyRaw = await decryptBw(send.key, userEnc, userMac);
          const derived = await deriveSendKeyParts(sendKeyRaw);
          nextSend.decName = await decryptField(send.name || '', derived.enc, derived.mac);
          nextSend.decNotes = await decryptField(send.notes || '', derived.enc, derived.mac);
          nextSend.decText = await decryptField(send.text?.text || '', derived.enc, derived.mac);
          if (send.file?.fileName) {
            const decFileName = await decryptField(send.file.fileName, derived.enc, derived.mac);
            nextSend.file = {
              ...(send.file || {}),
              fileName: decFileName || send.file.fileName,
            };
          }
          nextSend.decShareKey = btoa(String.fromCharCode(...sendKeyRaw))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
          nextSend.shareUrl = `${args.origin}/#/send/${send.accessId}/${nextSend.decShareKey}`;
        } else {
          nextSend.decName = '';
          nextSend.decNotes = '';
          nextSend.decText = '';
        }
      } catch {
        nextSend.decName = 'Decrypt failed';
      }
      return nextSend;
    })
  );
}
