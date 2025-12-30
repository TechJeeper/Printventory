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
- **Server Mode**: Run Printventory as a web server accessible from any device on your local network (see [Server Mode](#server-mode) section for details)
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
- **Windows**: `Printventory-Setup-1.22.5.exe` (NSIS installer)
- **macOS**: Universal binary (Intel and Apple Silicon) DMG
- **Linux/Docker**: `printventory-docker-1.22.5.zip` (Docker distribution package)

### Data Storage

- **Windows**: `%LOCALAPPDATA%\Printventory`
- **macOS**: `~/Library/Application Support/Printventory`

The database and thumbnails are preserved during updates. Backups are automatically created before updates.

## Server Mode

Printventory can run in **Server Mode**, allowing you to access your 3D model library from any device on your local network through a web browser. This is particularly useful for accessing your collection from multiple computers or devices without installing the application on each one.

### What is Server Mode?

Server Mode runs Printventory as an HTTP server on port 5000, making it accessible from any device on your local network through a web browser. The application interface is served via HTTP, and all functionality remains available remotely.

### Starting Server Mode

To start Printventory in Server Mode, launch it with the `--server` flag:

**Windows:**
```bash
printventory.exe --server
```

**Command Line:**
```bash
printventory --server
```

The server will start and continue running until you close the application. You'll see console output indicating the server is running:
```
Printventory server mode started
Server running at http://0.0.0.0:5000
Access from remote browsers: http://<your-ip>:5000
Server mode requires UNC paths for all file operations
```

### Accessing the Server

Once started, you can access Printventory from any browser on your network:

```
http://<your-computer-ip>:5000
```

For example, if your computer's IP address is `192.168.1.100`:
```
http://192.168.1.100:5000
```

### Important Requirements

- **Path Requirements**: 
  - **Windows Server Mode**: Requires UNC (Universal Naming Convention) paths for all file operations
    - UNC paths use the format: `\\server\share\path\to\file`
    - Local drive paths (C:\, D:\, etc.) will **not work** in Server Mode
  - **Docker/Linux Server Mode**: Uses Linux-style absolute paths (e.g., `/mnt/network-share/path/to/file`)
    - Network shares must be mounted into the container (see [Docker Deployment](#docker-deployment-linux-server-mode))
- **Network Access**: The server listens on all network interfaces (0.0.0.0) on port 5000
- **Firewall**: You may need to allow Printventory through your firewall to access it from other devices
- **Network Security**: Server Mode is designed for local network use. For production deployments, consider additional security measures

### Use Cases

- Access your model library from multiple computers on the same network
- Browse your collection from tablets or mobile devices
- Share your library with others on your local network
- Centralized model management for a team or workshop

### Docker Deployment

Printventory can also be deployed as a Docker container for Linux server mode deployment. See the [Docker Deployment](#docker-deployment-linux-server-mode) section for detailed instructions.

### Getting Help

For more information about Server Mode, use the **Help > Server Mode Info** menu item in the application, which provides detailed information and instructions including Docker deployment options.

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

## Docker Deployment (Linux Server Mode)

Printventory can be deployed as a Docker container for easy server mode deployment on Linux systems. This is ideal for headless servers or containerized environments.

### Distribution Options

**Option 1: Pre-built Distribution Package (Recommended)**
- Download `printventory-docker-${version}.zip` from releases
- Extract and run: `docker-compose up -d`

**Option 2: Build from Source**
- Clone the repository and build the Docker image yourself
- See "Building the Docker Image" section below

**Option 3: Docker Hub (if available)**
- Pull pre-built image: `docker pull yourusername/printventory:latest`
- Run: `docker run -d -p 5000:5000 -v printventory-data:/root/.config/Printventory yourusername/printventory:latest`

### Prerequisites

- [Docker](https://www.docker.com/get-started) installed on your Linux system
- [Docker Compose](https://docs.docker.com/compose/install/) (optional, for easier deployment)

### Building the Docker Image

**From distribution package:**
```bash
# Extract the zip file
unzip printventory-docker-*.zip
cd printventory-docker-*

# Build the image
docker build -t printventory:latest .
```

**From source repository:**
```bash
# Build the image from project root
docker build -t printventory:latest .
```

### Running with Docker

#### Using Docker Run

```bash
docker run -d \
  --name printventory-server \
  -p 5000:5000 \
  -v printventory-data:/root/.config/Printventory \
  --restart unless-stopped \
  printventory:latest
```

#### Using Docker Compose (Recommended)

```bash
docker-compose up -d
```

This will:
- Build the image (if not already built)
- Start the container in detached mode
- Map port 5000 to your host
- Create a persistent volume for database and application data
- Configure automatic restart

### Accessing the Server

Once the container is running, access Printventory from any browser:

```
http://<your-server-ip>:5000
```

Or if running locally:

```
http://localhost:5000
```

### Managing the Container

**View logs:**
```bash
docker logs printventory-server
# or with docker-compose:
docker-compose logs -f
```

**Stop the container:**
```bash
docker stop printventory-server
# or with docker-compose:
docker-compose down
```

**Start the container:**
```bash
docker start printventory-server
# or with docker-compose:
docker-compose up -d
```

**Restart the container:**
```bash
docker restart printventory-server
# or with docker-compose:
docker-compose restart
```

### Data Persistence

The Docker setup uses a named volume (`printventory-data`) to persist your database and application data. This ensures your data survives container restarts and updates.

**View volume location:**
```bash
docker volume inspect printventory-data
```

**Backup the volume:**
```bash
docker run --rm -v printventory-data:/data -v $(pwd):/backup alpine tar czf /backup/printventory-backup.tar.gz -C /data .
```

**Restore from backup:**
```bash
docker run --rm -v printventory-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/printventory-backup.tar.gz"
```

### Network Shares and File Access

**In Docker containers**, you cannot directly access Windows UNC paths (`\\server\share\path`). Instead, you need to mount network shares into the container.

#### Option 1: Mount SMB/CIFS Share (Recommended)

1. **Install CIFS utilities on the Docker host:**
   ```bash
   sudo apt-get update
   sudo apt-get install cifs-utils
   ```

2. **Create a mount point and mount the share:**
   ```bash
   sudo mkdir -p /mnt/network-share
   sudo mount -t cifs //server/share /mnt/network-share -o username=youruser,password=yourpass,uid=$(id -u),gid=$(id -g)
   ```

3. **Add the mount to docker-compose.yml:**
   ```yaml
   volumes:
     - printventory-data:/root/.config/Printventory
     - /mnt/network-share:/mnt/network-share:ro
   ```

4. **Use Linux-style paths** in Printventory:
   - Format: `/mnt/network-share/path/to/files`
   - The application will automatically detect Docker and accept absolute paths

#### Option 2: Mount Local Directory

If your files are on the Docker host machine:

```yaml
volumes:
  - printventory-data:/root/.config/Printventory
  - /host/path/to/models:/mnt/models:ro
```

Then use paths like: `/mnt/models/subdirectory`

#### Option 3: Persistent SMB Mount (Auto-mount on boot)

To automatically mount on host reboot, add to `/etc/fstab`:

```
//server/share /mnt/network-share cifs username=user,password=pass,uid=1000,gid=1000,iocharset=utf8,file_mode=0777,dir_mode=0777 0 0
```

**Note:** When running in Docker, the application automatically detects the container environment and accepts Linux-style absolute paths (starting with `/`) instead of requiring UNC paths.

### Troubleshooting

**Container won't start:**
- Check logs: `docker logs printventory-server`
- Verify port 5000 is not in use: `netstat -tuln | grep 5000`
- Ensure Docker has sufficient resources (memory, CPU)

**Can't access the web interface:**
- Verify the container is running: `docker ps`
- Check firewall rules allow port 5000
- Verify port mapping: `docker port printventory-server`

**Database issues:**
- Ensure the volume has write permissions
- Check volume mount: `docker volume inspect printventory-data`

### Resource Requirements

- **Minimum**: 512MB RAM, 1 CPU core
- **Recommended**: 2GB RAM, 2 CPU cores
- **Disk**: At least 1GB for the image and dependencies, plus space for your database

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