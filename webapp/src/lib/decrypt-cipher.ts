import { decryptStr, decryptBw } from './crypto';
import type { Cipher } from './types';

async function decryptField(
  value: string | null | undefined,
  enc: Uint8Array,
  mac: Uint8Array,
): Promise<string> {
  if (!value || typeof value !== 'string') return '';
  try { return await decryptStr(value, enc, mac); } catch { return value; }
}

export async function decryptSingleCipher(
  encrypted: Cipher,
  userEnc: Uint8Array,
  userMac: Uint8Array,
): Promise<Cipher> {
  let itemEnc = userEnc;
  let itemMac = userMac;
  if (encrypted.key) {
    try {
      const itemKey = await decryptBw(encrypted.key, userEnc, userMac);
      itemEnc = itemKey.slice(0, 32);
      itemMac = itemKey.slice(32, 64);
    } catch { /* keep user key */ }
  }

  const decrypted: Cipher = {
    ...encrypted,
    decName: await decryptField(encrypted.name, itemEnc, itemMac),
    decNotes: await decryptField(encrypted.notes, itemEnc, itemMac),
  };

  if (encrypted.login) {
    decrypted.login = {
      ...encrypted.login,
      decUsername: await decryptField(encrypted.login.username, itemEnc, itemMac),
      decPassword: await decryptField(encrypted.login.password, itemEnc, itemMac),
      decTotp: await decryptField(encrypted.login.totp, itemEnc, itemMac),
      uris: await Promise.all((encrypted.login.uris || []).map(async (u) => ({
        ...u,
        decUri: await decryptField(u.uri, itemEnc, itemMac),
      }))),
    };
  }

  if (Array.isArray(encrypted.passwordHistory)) {
    decrypted.passwordHistory = await Promise.all(
      encrypted.passwordHistory.map(async (entry) => ({
        ...entry,
        decPassword: await decryptField(entry?.password, itemEnc, itemMac),
      }))
    );
  }

  if (encrypted.card) {
    decrypted.card = {
      ...encrypted.card,
      decCardholderName: await decryptField(encrypted.card.cardholderName, itemEnc, itemMac),
      decNumber: await decryptField(encrypted.card.number, itemEnc, itemMac),
      decBrand: await decryptField(encrypted.card.brand, itemEnc, itemMac),
      decExpMonth: await decryptField(encrypted.card.expMonth, itemEnc, itemMac),
      decExpYear: await decryptField(encrypted.card.expYear, itemEnc, itemMac),
      decCode: await decryptField(encrypted.card.code, itemEnc, itemMac),
    };
  }

  if (encrypted.identity) {
    decrypted.identity = {
      ...encrypted.identity,
      decTitle: await decryptField(encrypted.identity.title, itemEnc, itemMac),
      decFirstName: await decryptField(encrypted.identity.firstName, itemEnc, itemMac),
      decMiddleName: await decryptField(encrypted.identity.middleName, itemEnc, itemMac),
      decLastName: await decryptField(encrypted.identity.lastName, itemEnc, itemMac),
      decUsername: await decryptField(encrypted.identity.username, itemEnc, itemMac),
      decCompany: await decryptField(encrypted.identity.company, itemEnc, itemMac),
      decSsn: await decryptField(encrypted.identity.ssn, itemEnc, itemMac),
      decPassportNumber: await decryptField(encrypted.identity.passportNumber, itemEnc, itemMac),
      decLicenseNumber: await decryptField(encrypted.identity.licenseNumber, itemEnc, itemMac),
      decEmail: await decryptField(encrypted.identity.email, itemEnc, itemMac),
      decPhone: await decryptField(encrypted.identity.phone, itemEnc, itemMac),
      decAddress1: await decryptField(encrypted.identity.address1, itemEnc, itemMac),
      decAddress2: await decryptField(encrypted.identity.address2, itemEnc, itemMac),
      decAddress3: await decryptField(encrypted.identity.address3, itemEnc, itemMac),
      decCity: await decryptField(encrypted.identity.city, itemEnc, itemMac),
      decState: await decryptField(encrypted.identity.state, itemEnc, itemMac),
      decPostalCode: await decryptField(encrypted.identity.postalCode, itemEnc, itemMac),
      decCountry: await decryptField(encrypted.identity.country, itemEnc, itemMac),
    };
  }

  if (encrypted.sshKey) {
    const fingerprint = encrypted.sshKey.keyFingerprint || encrypted.sshKey.fingerprint || '';
    decrypted.sshKey = {
      ...encrypted.sshKey,
      decPrivateKey: await decryptField(encrypted.sshKey.privateKey, itemEnc, itemMac),
      decPublicKey: await decryptField(encrypted.sshKey.publicKey, itemEnc, itemMac),
      keyFingerprint: fingerprint || null,
      fingerprint: fingerprint || null,
      decFingerprint: await decryptField(fingerprint, itemEnc, itemMac),
    };
  }

  if (encrypted.fields) {
    decrypted.fields = await Promise.all(
      encrypted.fields.map(async (field) => ({
        ...field,
        decName: await decryptField(field.name, itemEnc, itemMac),
        decValue: await decryptField(field.value, itemEnc, itemMac),
      }))
    );
  }

  return decrypted;
}
