# Printventory

Printventory is an Electron-based application for managing 3D printing inventory and projects. It helps you organize your 3D model collection with powerful management features.

![Printventory Logo](logo.png)

## 🌐 Links

- **Website**: [printventory.com](https://printventory.com)
- **Discord**: [Join our Discord community](https://discord.com/invite/JXcZHT77ua)

## ✨ Features

- Track 3D printing filaments and materials
- Manage printing projects and 3D models
- Organize models with tags and categories
- Track print status and designer information
- Find and manage duplicate files
- User-friendly interface for desktop environments
- Multi-edit features for batch operations
- Customizable model background color
- AI-powered tagging system
- Advanced search and filtering capabilities

For a complete list of features and detailed usage guide, see the [GUIDE.md](GUIDE.md) file.

## 🚀 Quick Start

### Prerequisites

Before building Printventory from source, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v16.x or later recommended)
- [npm](https://www.npmjs.com/) (v8.x or later)
- [Git](https://git-scm.com/)

### Platform-Specific Requirements

#### macOS
- **Xcode Command Line Tools**: Install via Terminal:
  ```bash
  xcode-select --install
  ```
- **macOS 10.15 (Catalina) or later** for building
- **Apple Silicon (M1/M2) or Intel processor** supported

#### Windows
- **Visual Studio Build Tools**: Download from [Microsoft Visual Studio](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
- **Windows 10 or later** for building
- **C++ development workload** must be installed in Visual Studio Build Tools

## 📦 Installation & Development

### 1. Clone the Repository

```bash
git clone https://github.com/techjeeper/printventory.git
cd printventory
```

### 2. Install Dependencies

```bash
npm install
```

This will automatically run the `postinstall` script to install app-specific dependencies.

### 3. Development Mode

To run the application in development mode:

```bash
npm start
```

This launches the Electron application with hot-reload enabled for development.

## 🏗️ Building for Production

### Build for All Platforms

To build the application for both macOS and Windows:

```bash
npm run build
```

### Platform-Specific Builds

#### macOS Build
```bash
npm run build:mac
```
This creates a universal macOS application (Intel and Apple Silicon) with both `.dmg` and `.zip` formats.

#### Windows Build
```bash
npm run build:win
```
This creates a Windows installer using NSIS with the following features:
- Custom installation directory selection
- Desktop and Start Menu shortcuts
- Per-machine installation
- Differential package updates

### Build Outputs

All build outputs are generated in the `dist` directory:
- **macOS**: `Printventory-{version}-universal.dmg` and `Printventory-{version}-universal.zip`
- **Windows**: `Printventory-Setup-{version}.exe`

## 🏗️ Application Architecture

```
Printventory/
├── main.js              # Main Electron process
├── preload.js           # Preload script for secure IPC communication
├── renderer.js          # Renderer process for UI interactions
├── index.html           # Main application UI
├── styles.css           # Application styling
├── renderer/            # Renderer process modules
│   ├── dialogs/         # Dialog components
│   ├── filters/         # Filter handlers
│   ├── models/          # Model management
│   ├── scanning/        # Directory scanning
│   └── utils/           # Utility functions
└── src/renderer/        # Additional renderer components
```

## 💾 Database

Printventory uses SQLite (via better-sqlite3) for data storage. The database file is automatically created in the user's application data directory:
- **macOS**: `~/Library/Application Support/Printventory/`
- **Windows**: `%APPDATA%\Printventory\`

## 🐛 Troubleshooting

### Common Issues

#### "Another instance is already running"
If you see this error when starting the app:
```bash
# Kill any existing Electron processes
pkill -f electron
# Then try again
npm start
```

#### Build Failures on macOS
If you encounter build issues on macOS:
```bash
# Reinstall Xcode Command Line Tools
sudo rm -rf /Library/Developer/CommandLineTools
xcode-select --install
```

#### Build Failures on Windows
If you encounter build issues on Windows:
1. Ensure Visual Studio Build Tools are installed with C++ workload
2. Run as Administrator if needed
3. Check that Python and Visual Studio Build Tools are in your PATH

### Node.js Version Issues
If you encounter compatibility issues, ensure you're using a compatible Node.js version:
```bash
# Check your Node.js version
node --version

# Use nvm to switch versions if needed
nvm use 18
```

## 🤝 Contributing

We welcome contributions! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Development Guidelines
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## 🆘 Support

- **Documentation**: Check [GUIDE.md](GUIDE.md) for detailed usage instructions
- **Issues**: File an issue on the [GitHub repository](https://github.com/yourusername/printventory/issues)
- **Discord**: Join our [Discord community](https://discord.gg/printventory) for real-time support
- **Website**: Visit [printventory.com](https://printventory.com) for more information

## 🙏 Acknowledgments

- Built with [Electron](https://electronjs.org/)
- 3D rendering powered by [Three.js](https://threejs.org/)
- Database management with [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3)
- AI features powered by [OpenAI](https://openai.com/)