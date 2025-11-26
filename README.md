Beook2PDF is a Windows App that allows you to export content from the DRM-protected Beook application as PDF.


🔨🔧🛠️🚧⚠>>> UNDER CONSTRUCTION <<<⚠🚧🛠️🔧🔨

Probably won't work for you! 

This is a vibe coded Next.js project. 

How it works basically:
Gets the raw, unencrypted html and css for each page of any book from the Beook SQL database.

- Many ToDo's and missing features
- Only tested for BAK Aviation learning material
- Uses Puppeteer to convert HTML/CSS to PDF (Bad AI slop solution)

Quiz answers and questions are now decrypted but not yet added to the pdf.


## Getting Started

First, run the development server:

      $ git clone https://github.com/Createyourfreeacc/beook2pdf.git
      $ cd beook2pdf
      $ npm install
      $ npm run dev

Open http://localhost:3000 with your browser to see the result.


If it doesn't work, you can try manually changing the paths, which are currently hardcoded as:

      $ "C:/Users/${username}/AppData/Roaming/ionesoft/beook/release/profiles/2/data/beook_book_v6.sqlite"


## Crypto

File: .global.keystore
Java KeyStore via the java.security.KeyStore API
JCEKS keystore implementation:
PBE = Password-Based Encryption
MD5 = hash function used in key derivation (PBKDF)
TripleDES = the block cipher used to encrypt/decrypt the entry
masterPassword = "TronkoXbalu.global.keystore8080"

DESEncrypter:
const KEY_STRING = "fdäK?s^dw-+ç,W!El"; // full Java string
const IV_STRING = "/D}$2al!"; // exactly 8 chars