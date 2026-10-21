import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as x509 from '@peculiar/x509';

// All key generation and signatures use Node's native WebCrypto implementation.
const provider = crypto.webcrypto;
x509.cryptoProvider.set(provider);
const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
const pair = () => provider.subtle.generateKey(algorithm, true, ['sign', 'verify']);
const serial = prefix => prefix + crypto.randomBytes(15).toString('hex');
const privatePem = async key => crypto.createPrivateKey({ key: Buffer.from(await provider.subtle.exportKey('pkcs8', key)), type: 'pkcs8', format: 'der' }).export({ type: 'pkcs8', format: 'pem' });

export async function certificates(directory, hostname, addresses) {
  const folder = path.join(directory, 'certificates');
  const rootFile = path.join(folder, 'root.crt');
  const rootKeyFile = path.join(folder, 'root.key');
  let ca, caKey;
  if (fs.existsSync(rootFile) && fs.existsSync(rootKeyFile)) {
    ca = new x509.X509Certificate(fs.readFileSync(rootFile, 'utf8'));
    // Accept previous PKCS#1 or PKCS#8 private keys without replacing the local CA.
    const der = crypto.createPrivateKey(fs.readFileSync(rootKeyFile)).export({ type: 'pkcs8', format: 'der' });
    caKey = await provider.subtle.importKey('pkcs8', der, algorithm, false, ['sign']);
  } else {
    const keys = await pair();
    ca = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: serial('01'), name: `CN=Brisa ${hostname.split('.')[0]} - CA local`,
      notBefore: new Date(Date.now() - 86400000), notAfter: new Date(Date.now() + 10 * 365 * 86400000),
      signingAlgorithm: algorithm, keys,
      extensions: [
        new x509.BasicConstraintsExtension(true, 0, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
        await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
      ]
    });
    caKey = keys.privateKey;
    fs.writeFileSync(rootKeyFile, await privatePem(caKey), { mode: 0o600 });
    fs.writeFileSync(rootFile, ca.toString('pem'), { mode: 0o600 });
  }
  const leafFile = path.join(folder, 'server.crt');
  const keyFile = path.join(folder, 'server.key');
  const names = [...new Set(['127.0.0.1', ...addresses])].sort();
  let reusable = false;
  if (fs.existsSync(leafFile) && fs.existsSync(keyFile)) {
    const current = new crypto.X509Certificate(fs.readFileSync(leafFile));
    reusable = new Date(current.validTo).getTime() > Date.now() + 30 * 86400000 &&
      current.verify(new crypto.X509Certificate(ca.toString('pem')).publicKey) &&
      Boolean(current.checkHost(hostname)) && names.every(ip => current.checkIP(ip));
  }
  if (!reusable) {
    const keys = await pair();
    const leaf = await x509.X509CertificateGenerator.create({
      serialNumber: serial('02'), subject: `CN=${hostname}`, issuer: ca.subject,
      publicKey: keys.publicKey, signingKey: caKey, signingAlgorithm: algorithm,
      notBefore: new Date(Date.now() - 86400000), notAfter: new Date(Date.now() + 365 * 86400000),
      extensions: [
        new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
        new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
        new x509.SubjectAlternativeNameExtension([
          { type: 'dns', value: hostname }, { type: 'dns', value: 'localhost' },
          ...names.map(ip => ({ type: 'ip', value: ip }))
        ])
      ]
    });
    fs.writeFileSync(keyFile, await privatePem(keys.privateKey), { mode: 0o600 });
    fs.writeFileSync(leafFile, leaf.toString('pem'), { mode: 0o600 });
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(leafFile), ca: fs.readFileSync(rootFile) };
}
