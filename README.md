# Beook2PDF

A Windows application that exports content from the DRM-protected Beook e-learning platform to PDF format.

> 🛠️🚧⚠️ **Work in Progress** — This project is under active development and may not work for all users or configurations.

## Features

### Core Functionality
- **Book Export**: Extracts raw HTML, CSS and fonts from the Beook database and converts pages to PDF
- **Multi-Book Support**: Select and export multiple books in a single PDF with customizable ordering
- **Table of Contents**: Automatic TOC generation with optional dedicated TOC pages
- **Quiz Integration**: Decrypts and exports quiz questions and answers directly into PDFs
- **Interactive Quiz Viewer**: Browse and practice quizzes with solution checking
- **Custom Quiz Management**: Create and manage your own quiz questions

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

- Only tested with a limited set of learning materials
- PDF generation uses Puppeteer (may have performance implications for very large books)
- Electron app requires manual server startup (not yet bundled as standalone executable)

## License
This app, "Beook2Pdf", is an independent product and is not affiliated with Ionesoft, the publisher and developer of Beook. The use of the word "Beook" does not imply any official approval or partnership with Ionesoft.
This project is for educational purposes only. Please respect the intellectual property rights of content creators and publishers.
