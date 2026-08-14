# How to replace the TLS certificate

nginx terminates TLS on port 8888 using the certificate at `certs/cert.pem` and the key at `certs/key.pem`. The browser requires HTTPS for microphone access (`getUserMedia`).

## Replace with a new self-signed certificate

```bash
cd ~/.hermes/toefl_tracker_v2
openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem \
  -days 365 -nodes -subj "/CN=localhost"
docker compose restart toefl-ssl
```

The cert and key files are bind-mounted into the nginx container, so a restart picks them up without a rebuild.

## Replace with a CA-signed certificate

1. Place your certificate chain at `certs/cert.pem` and the private key at `certs/key.pem`.
2. Restart nginx:
   ```bash
   docker compose restart toefl-ssl
   ```

If your CA provides a bundle (root + intermediate + leaf), concatenate them in that order into `cert.pem`.

## Verify the new certificate is being served

```bash
openssl s_client -connect localhost:8888 -servername localhost </dev/null 2>/dev/null \
  | openssl x509 -noout -dates
```

This prints the `notBefore` and `notAfter` dates of the certificate nginx is actually serving.
