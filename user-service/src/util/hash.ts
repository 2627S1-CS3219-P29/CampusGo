// hash a password using a secure industry-standard pbkdf
import argon2 from 'argon2';

/**
 * Hash a plaintext password using Argon2id.
 *
 * The returned string is a self-describing PHC-format salted hash
 *
 * @example
 *   const hash = await hashPassword('correct horse battery staple');
 */
export function hashPassword(plaintext: string): Promise<string> {
    if (typeof plaintext !== 'string' || plaintext.length === 0) {
        throw new TypeError('Password must be a non-empty string');
    }
    
    return argon2.hash(plaintext, {
        type: argon2.argon2id,
    });
}

/**
 * Verify a plaintext password against a stored Argon2 hash.
 *
 * Uses the library's constant-time comparison internally. Returns `false`
 * for malformed hashes
 */
export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
    if (!hash || !plaintext)
        return false;
    try {
        return await argon2.verify(hash, plaintext);
    } catch {
        return false;
    }
}
