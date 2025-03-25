# Printventory

Printventory is an Electron-based application for managing 3D printing inventory and projects. It helps you organize your 3D model collection with powerful management features.

![Printventory Logo](logo.png)

## Features

- Track 3D printing filaments and materials
- Manage printing projects and 3D models
- Organize models with tags and categories
- Track print status and designer information
- Find and manage duplicate files
- User-friendly interface for desktop environments
- Multi-edit features for batch operations
- Customizable model background color

For a complete list of features, see the [GUIDE.md](GUIDE.md) file.

## License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Prerequisites

Before building Printventory from source, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v14.x or later)
- [npm](https://www.npmjs.com/) (v6.x or later)
- [Git](https://git-scm.com/)
- Platform-specific build tools:
  - **Windows**: Visual Studio Build Tools with C++ development workload
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)

## Building from Source

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

This will also run the `postinstall` script to install app-specific dependencies.

### Development Mode

To run the application in development mode:

```bash
npm start
```

This will launch the Electron application with hot-reload enabled.

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

- `main.js` - Main Electron process
- `renderer.js` - Renderer process for UI interactions
- `preload.js` - Preload script for secure IPC communication
- `index.html` - Main application UI
- `styles.css` - Application styling

## Database

Printventory uses SQLite (via better-sqlite3) for data storage. The database file is created in the user's application data directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions, please file an issue on the GitHub repository.