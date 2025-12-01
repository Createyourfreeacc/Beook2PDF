# Beook2PDF

A Windows application that exports content from the DRM-protected Beook e-learning platform to PDF format.

> 🛠️🚧⚠️ **Work in Progress** — This project is under active development and may not work for all users or configurations.

## Features

- Extracts raw HTML/CSS content from the Beook SQLite database
- Converts book pages to PDF using Puppeteer
- Decrypts quiz questions and answers
- Browse and select books from your Beook library
- Modern web-based interface built with Next.js

## Requirements

- Windows 10 or later
- Node.js 18+
- Beook desktop application installed with downloaded books

## Installation

```bash
git clone https://github.com/Createyourfreeacc/beook2pdf.git
cd beook2pdf
npm install
```

## Usage

Start the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Configuration

The application looks for the Beook database at the default location:

```
C:/Users/{username}/AppData/Roaming/ionesoft/beook/release/profiles/2/data/beook_book_v6.sqlite
```

If your installation differs, you may need to update the path in the settings.

## Technical Details

### Encryption

The Beook application uses multiple layers of encryption:

**Keystore (`.global.keystore`)**
- Java KeyStore via `java.security.KeyStore` API
- JCEKS implementation with PBE (Password-Based Encryption)
- Key derivation: MD5-based PBKDF
- Cipher: TripleDES

**Content Encryption (DESEncrypter)**
- Algorithm: DES
- 8-byte initialization vector

## Tested Courses

This tool has been tested with the following learning materials:

| Reference |
|------|
| 978-3-905036-87-9 |
| 978-3-03901-007-3 |
| 978-3-905036-95-4 |
| 978-3-03901-002-8 |
| 978-3-03901-000-4 |
| 978-3-03901-011-0 |
| 978-3-03901-004-2 |
| 978-3-03901-003-5 |
| 978-3-905036-94-7 |
| 978-3-905036-96-1 |
| 978-3-03901-015-8 |
| 978-3-905036-88-6 |

## Known Limitations

- Only tested with few learning materials
- Quiz content is decrypted but not yet included in PDF output
- PDF generation uses Puppeteer (may have performance implications for large books)

## License
This app, "Beook2Pdf", is an independent product and is not affiliated with Ionesoft, the publisher and developer of Beook. The use of the word "Beook" does not imply any official approval or partnership with Ionesoft.
This project is for educational purposes only. Please respect the intellectual property rights of content creators and publishers.
