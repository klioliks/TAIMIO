import { createPrivateKey, createPublicKey, sign, verify } from 'crypto'
import { ACCESS_PUBLIC_KEY_B64 } from '../../shared/accessPublicKey'

export function verifyWithAppPublicKey(data: Uint8Array, signature: Uint8Array): boolean {
  return verifyEd25519(ACCESS_PUBLIC_KEY_B64, data, signature)
}

export function verifyEd25519(publicB64: string, data: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: Buffer.from(publicB64, 'base64'),
    format: 'der',
    type: 'spki'
  })
  return verify(null, Buffer.from(data), key, Buffer.from(signature))
}

export function signEd25519(privateB64: string, data: Uint8Array): Uint8Array {
  const key = createPrivateKey({
    key: Buffer.from(privateB64, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  return new Uint8Array(sign(null, Buffer.from(data), key))
}
