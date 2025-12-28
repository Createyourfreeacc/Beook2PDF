# Beook2PDF

A Windows application that exports content from the DRM-protected Beook e-learning platform to PDF format.

<div align="center">

  Check this out
  
<a href="https://beook2pdf.com/"><img alt="Visit the website" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/documentation/website_vector.svg"></a>
<a href="https://discord.gg/6CKPwv5h"><img alt="Discord Server" height="56" src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/social/discord-plural_vector.svg"></a>

</div>

> ⚠️ **Work in Progress** — This project is under development and may not work for all users.

## Features

### Core Functionality
- **Book Export**: Extracts raw HTML, CSS and fonts from the Beook database and converts pages to PDF
- **Multi-Book Support**: Select and export multiple books in a single PDF with customizable ordering
- **Table of Contents**: Automatic TOC generation with optional dedicated TOC pages
- **Quiz Integration**: Decrypts and exports quiz questions and answers directly into PDFs
- **Interactive Quiz Viewer**: Browse and practice quizzes with solution checking
- **Custom Quiz Management**: Create and manage your own quiz questions

## Requirements

- Windows 10 or newer
- Node.js 18+
- Beook desktop application installed with downloaded books

## Installation

```bash
git clone https://github.com/Createyourfreeacc/beook2pdf.git
cd beook2pdf
npm install
```

## Usage

### Web Application

Start the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Desktop Application (Electron)

Run the Electron wrapper:

```bash
npm run electron
```

Note: The Electron app currently connects to `http://localhost:3000`, so you'll need to run `npm run dev` in a separate terminal first.

## Build

```bash
rmdir /s /q node_modules
del package-lock.json
setx PUPPETEER_CACHE_DIR ".puppeteer"
npm install
powershell -ExecutionPolicy Bypass -File .\tools\clean-dist-win.ps1
```

## Tested Courses

This tool has been tested with the following learning materials:

| Reference | | | |
|------|------|------|------|
| 978-3-905036-87-9 | 978-3-03901-007-3 | 978-3-03901-002-8 | 978-3-905036-94-7 |
| 978-3-905036-95-4 | 978-3-03901-011-0 | 978-3-03901-000-4 | 978-3-905036-88-6 |
| 978-3-03901-003-5 | 978-3-03901-004-2 | 978-3-905036-96-1 | 978-3-03901-015-8 |


## Known Limitations

- Only tested with a limited set of learning materials (help welcomed)
- PDF generation uses Puppeteer (may have performance implications for very large books)
- huge installer/installation size

## License
This app, "Beook2PDF", is an independent product and is not affiliated with Ionesoft, the publisher and developer of Beook. The use of the word "Beook" does not imply any official approval or partnership with Ionesoft.
This project is for personal use only. Please respect the intellectual property rights of content creators and publishers.
