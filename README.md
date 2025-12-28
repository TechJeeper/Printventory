# Printventory

**Version 1.22.1**

Printventory is an Electron-based desktop application for managing your 3D printing model collection. It helps you organize, catalog, and manage STL and 3MF files with powerful features including automatic scanning, thumbnail generation, tagging, and duplicate detection.

![Printventory Logo](logo.png)

## Features

### Core Functionality
- **Directory Scanning**: Automatically scan and catalog STL and 3MF files (up to 50MB per file)
- **3D Model Preview**: View thumbnails of your 3D models with customizable background colors
- **File Management**: Quick access to file locations, delete files with database cleanup
- **Database Backup & Restore**: Protect your data with backup and restore functionality

### Organization & Metadata
- **Tagging System**: Organize models with custom tags and categories
- **Designer Tracking**: Assign and track designer information for each model
- **Print Status**: Track whether models have been printed, planned, or are in progress
- **Source URLs**: Store links to where you found or purchased models
- **Notes**: Add custom notes to any model
- **Parent/Child Relationships**: Link related models together
- **License Tracking**: Assign licenses to models

### Advanced Features
- **Multi-Edit Mode**: Select and edit multiple models simultaneously for batch operations
- **Duplicate Detection**: Find duplicate files based on content hash with visual comparison
- **Print Roulette**: Randomly select models from your collection
- **AI Tagging**: Automated tag suggestions using AI
- **Search & Filter**: Real-time search by filename and filter by designer, tags, print status, parent model, or license
- **Tag Manager**: Comprehensive tag management interface
- **Metadata Editor**: Bulk metadata editing capabilities
- **Thumbnail Management**: Generate, regenerate, or purge model thumbnails

### User Interface
- **Responsive Grid Layout**: Browse models in an intuitive grid view
- **Context Menu**: Quick actions via right-click menu
- **Sort Options**: Sort by name, size, or date
- **Auto-save**: Changes are automatically saved

For a complete list of features and detailed usage instructions, see the [GUIDE.md](GUIDE.md) file.

## Installation

### Pre-built Releases

Download the latest release for your platform:
- **Windows**: `Printventory-Setup-1.22.1.exe` (NSIS installer)
- **macOS**: Universal binary (Intel and Apple Silicon) DMG

### Data Storage

- **Windows**: `%LOCALAPPDATA%\Printventory`
- **macOS**: `~/Library/Application Support/Printventory`

The database and thumbnails are preserved during updates. Backups are automatically created before updates.

## Building from Source

### Prerequisites

Before building Printventory from source, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v16.x or later recommended)
- [npm](https://www.npmjs.com/) (v8.x or later)
- [Git](https://git-scm.com/)
- Platform-specific build tools:
  - **Windows**: Visual Studio Build Tools with C++ development workload
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)

### Clone the Repository

```bash
git clone https://github.com/yourusername/printventory.git
cd printventory
```

### Install Dependencies

Install all required dependencies:

```bash
npm install
```

This will also run the `postinstall` script to install app-specific dependencies (including native modules like `better-sqlite3`).

### Development Mode

To run the application in development mode:

```bash
npm start
```

This will launch the Electron application.

### Building for Production

#### Build for All Platforms

To build the application for both macOS and Windows:

```bash
npm run build
```

#### Build for macOS Only

To build a universal macOS application (Intel and Apple Silicon):

```bash
npm run build:mac
```

#### Build for Windows Only

To build for Windows:

```bash
npm run build:win
```

All build outputs will be generated in the `dist` directory.

## Application Structure

### Core Files
- `main.js` - Main Electron process and application logic
- `renderer.js` - Renderer process for UI interactions and model management
- `preload.js` - Preload script for secure IPC communication between main and renderer
- `index.html` - Main application UI structure
- `styles.css` - Application styling

### Feature Modules
- `aitagging.js` - AI-powered tagging functionality
- `search.js` - Search and filtering implementation
- `slicer.js` - 3D model slicing and thumbnail generation
- `guide.js` - Interactive guide system
- `scan-worker.js` - Background worker for directory scanning

### Build & Configuration
- `package.json` - Project configuration and dependencies
- `playwright.config.js` - Testing configuration
- `installer.nsh` - Windows installer customizations

## Technology Stack

- **Electron** ^39.2.4 - Desktop application framework
- **better-sqlite3** ^12.5.0 - SQLite database for data storage
- **Three.js** ^0.181.2 - 3D model rendering and preview
- **Fuse.js** ^7.1.0 - Fuzzy search functionality
- **OpenAI** ^6.9.1 - AI tagging features
- **Puppeteer** ^24.31.0 - Browser automation for certain features

## Database

Printventory uses SQLite (via `better-sqlite3`) for data storage. The database file (`printventory.db`) is created in the user's application data directory and stores:
- Model metadata (name, path, size, dates)
- Thumbnails (as base64 or file references)
- Tags, designers, print status, notes, and other custom fields
- Relationships between models

## File Support

- **STL files** - Standard Triangle Language format
- **3MF files** - 3D Manufacturing Format
- **ZIP Archives** - Models within Zip files
- **Size limit**: 50MB per file (Edit in Settings)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. When contributing:
- Follow existing code style and patterns
- Test your changes thoroughly
- Update documentation as needed

## License

This project is licensed under the ISC License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Support

If you encounter any issues or have questions:
- File an issue on the GitHub repository
- Check the [GUIDE.md](GUIDE.md) for detailed usage instructions
- Join the Discord community (mentioned in the application)

## Author

**TechJeeper Designs**

---

**Note**: Always create a manual backup before uninstalling the application to preserve your data.