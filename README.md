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
- **Folder & ZIP bundle grouping**: Automatically group models from the same subfolder or ZIP archive; preview all parts in one 3D view
- **License Tracking**: Assign licenses to models

### Advanced Features
- **Server Mode**: Run Printventory as a web server accessible from any device on your local network (see [Server Mode](#server-mode) section for details)
- **Multi-Edit Mode**: Select and edit multiple models simultaneously for batch operations
- **Duplicate Detection**: Find duplicate files based on content hash with visual comparison
- **Print Roulette**: Randomly select models from your collection
- **AI Tagging**: Automated tag suggestions using AI
- **3D bundle preview**: Open every STL/3MF in a folder or ZIP in a single preview layout
- **Send to Slicer from preview**: Open the current model or entire bundle in your configured slicer (new instance when already running)
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

See [CHANGELOG.md](CHANGELOG.md) for recent feature additions and migration notes.

## Installation

### Pre-built Releases

Download the latest release for your platform:
- **Windows**: `Printventory-Setup-2.1.17.exe` (NSIS installer)
- **macOS**: Universal binary (Intel and Apple Silicon) DMG
- **Linux/Docker**: `printventory/printventory:latest` on Docker Hub (or `printventory-docker-2.1.17.zip`)

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
- **STL Home Setting**: The STL Home setting follows the same path format rules as regular scanning. See the [STL Home Setting](#stl-home-setting-server-mode) section below for details on automatic and periodic scanning.

### Use Cases

- Access your model library from multiple computers on the same network
- Browse your collection from tablets or mobile devices
- Share your library with others on your local network
- Centralized model management for a team or workshop

### Docker Deployment

Printventory can also be deployed as a Docker container for Linux server mode deployment. See the [Docker Deployment](#docker-deployment-linux-server-mode) section for detailed instructions.

### STL Home Setting

The STL Home setting allows automatic scanning of a directory on startup and, in server mode, periodic scanning for new files. This is particularly useful for keeping your library up-to-date automatically.

#### Setting STL Home in Server Mode

1. Access the Printventory web interface at `http://<your-ip>:5000`
2. Navigate to **Settings → STL Home**
3. Enter the directory path:
   - **Windows Server Mode**: Use UNC path format (e.g., `\\server\share\models`)
   - The path must be accessible from the server machine
4. Configure the **Update Frequency** (default: 60 minutes):
   - This determines how often the STL Home directory is automatically scanned for new files
   - Range: 1-1440 minutes (1 minute to 24 hours)
5. Click **Save**

#### How It Works

- **On Startup**: When Printventory starts in server mode, it automatically scans the STL Home directory if one is configured
- **Periodic Scanning**: In server mode, Printventory will automatically scan the STL Home directory at the configured interval
- **Path Requirements**: STL Home paths follow the same format rules as regular scanning:
  - **Windows Server Mode**: Must use UNC paths (`\\server\share\path`)
  - Paths are validated when saved
- **Background Scanning**: Periodic scans run in the background and won't disrupt the web interface

#### Clearing STL Home

To disable automatic scanning, clear the STL Home directory field and save. This will stop both startup and periodic scanning.

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

#### Build for Linux AppImage (from Windows)

To build a Linux AppImage from Windows, you need either WSL (Windows Subsystem for Linux) or Docker:

**Prerequisites:**
- **Option 1 (Recommended)**: WSL with Node.js installed
  - Install WSL: `wsl --install`
  - Install Node.js in WSL: `wsl sudo apt-get update && wsl sudo apt-get install -y nodejs npm`
- **Option 2**: Docker Desktop
  - Install from: https://www.docker.com/products/docker-desktop

**Build Command:**

```bash
npm run build:linux
```

Or using PowerShell:

```powershell
.\scripts\build-linux-appimage.ps1
```

The script will automatically detect and use WSL if available, otherwise it will fall back to Docker. The AppImage will be generated in the `dist` directory.

**Note**: The first build may take longer as dependencies need to be installed in the Linux environment.

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

**Option 3: Docker Hub (Recommended for Quick Deployment)**
- Pull and run the pre-built image from Docker Hub
- No need to build from source - see "Pulling from Docker Hub" section below

### Pulling from Docker Hub

If the Printventory Docker image has been published to Docker Hub, you can pull and run it directly without building from source.

#### Prerequisites

- [Docker](https://www.docker.com/get-started) installed
- Docker Desktop running (if on Windows/Mac)

#### Pulling the Image

**Pull the latest version:**
```bash
docker pull printventory/printventory:latest
```

**Pull a specific version:**
```bash
docker pull printventory/printventory:1.23.0
```

The image is available on Docker Hub at: [https://hub.docker.com/r/printventory/printventory](https://hub.docker.com/r/printventory/printventory)

#### Running with Docker Run

**Basic run command:**
```bash
docker run -d \
  --name printventory-server \
  -p 5000:5000 \
  -v ./data:/root/.config/Printventory \
  --restart unless-stopped \
  printventory/printventory:latest
```

**With network share mounted (Windows - mapped drive):**
```bash
# Step 1: Map the network share to a drive letter on Windows
net use Z: \\server\share /persistent:yes

# Step 2: Run container with volume mount and STL_HOME environment variable
# Maps Windows Z: drive to /mnt/network-share inside container
docker run -d \
  --name printventory-server \
  -p 5000:5000 \
  -v ./data:/root/.config/Printventory \
  -v Z:/:/mnt/network-share:ro \
  -e STL_HOME=/mnt/network-share/models \
  --restart unless-stopped \
  printventory/printventory:latest

# Step 3: Use Linux-style paths in Printventory
# Example: /mnt/network-share/models/myfile.stl
# STL Home is automatically configured via STL_HOME environment variable
```

**With network share mounted (Linux - SMB/CIFS):**
```bash
# Step 1: Mount the network share on the Linux host
sudo mkdir -p /mnt/network-share
sudo mount -t cifs //server/share /mnt/network-share -o username=user,password=pass,uid=$(id -u),gid=$(id -g)

# Step 2: Run container with volume mount and STL_HOME environment variable
# Maps host /mnt/network-share to /mnt/network-share inside container
docker run -d \
  --name printventory-server \
  -p 5000:5000 \
  -v ./data:/root/.config/Printventory \
  -v /mnt/network-share:/mnt/network-share:ro \
  -e STL_HOME=/mnt/network-share/models \
  --restart unless-stopped \
  printventory/printventory:latest

# Step 3: Use Linux-style paths in Printventory
# Example: /mnt/network-share/models/myfile.stl
# STL Home is automatically configured via STL_HOME environment variable
```

#### Running with Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  printventory:
    image: printventory/printventory:latest
    container_name: printventory-server
    ports:
      - "5000:5000"
    volumes:
      # Persist database and application data to local directory
      # Database is stored in ./data directory on the host filesystem
      # This ensures data persists when the image is updated
      - ./data:/root/.config/Printventory
      
      # Option 1: Mount Windows mapped drive (Windows Docker Desktop)
      # First, map network share: net use Z: \\server\share /persistent:yes
      # Then uncomment the line below and use /mnt/network-share in Printventory
      # - Z:/:/mnt/network-share:ro
      
      # Option 2: Mount Linux SMB/CIFS share (Linux host)
      # First, mount on host: sudo mount -t cifs //server/share /mnt/network-share -o username=user,password=pass
      # Then uncomment the line below and use /mnt/network-share in Printventory
      # - /mnt/network-share:/mnt/network-share:ro
      
      # Option 3: Mount local directory (if files are on Docker host)
      # Example: mount host /home/user/models to /mnt/models in container
      # Then use /mnt/models in Printventory
      # - /home/user/models:/mnt/models:ro
    environment:
      # Optional: Set STL Home directory via environment variable
      # This will automatically configure the STL Home setting in Printventory
      # Use Linux-style absolute paths (e.g., /mnt/network-share/models)
      # The path must match a mounted volume in your Docker configuration
      # - STL_HOME=/mnt/network-share/models
    restart: unless-stopped
```

Then run:
```bash
docker compose up -d
```

#### NVIDIA GPU (optional)

Server-side thumbnail jobs render with WebGL inside the container. By default the image uses **SwiftShader** (CPU). To use a host NVIDIA GPU:

1. Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host.
2. Pass the GPU into the container **and** enable the `graphics` driver capability (required for WebGL — `compute,utility` alone is not enough):

```yaml
services:
  printventory:
    image: printventory/printventory:latest
    gpus: all
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=graphics,compute,utility
      - PRINTVENTORY_GPU=auto   # or nvidia | swiftshader
```

3. Recreate the container (`docker compose up -d --force-recreate`), then open **Help → System Report**:
   - **Client GPU** = your browser (previews)
   - **Server / App GPU** = container WebGL backend + `nvidia-smi`

If System Report still shows SwiftShader while `nvidia-smi` lists a card, `graphics` is usually missing from `NVIDIA_DRIVER_CAPABILITIES`, or the image predates GPU auto-detect.

**Memory note:** Host RAM (e.g. 96GB) is not used automatically. Unraid/Compose often caps the container (or the image used to hard-cap V8 at 3GB). Raise the container memory limit and, if needed, set `PRINTVENTORY_MAX_OLD_SPACE_MB=8192` (or higher). Logs showing `OOM error in V8: Zone Allocation failed` are the V8 heap limit, not the host running out of RAM.

#### Accessing the Server

Once the container is running, access Printventory from your browser:

- **Local machine:** `http://localhost:5000`
- **Network access:** `http://<your-ip>:5000`

#### Managing the Container

**View logs:**
```bash
docker logs printventory-server
# Follow logs in real-time:
docker logs -f printventory-server
```

**Stop the container:**
```bash
docker stop printventory-server
```

**Start the container:**
```bash
docker start printventory-server
```

**Restart the container:**
```bash
docker restart printventory-server
```

**Remove the container:**
```bash
docker stop printventory-server
docker rm printventory-server
```

**Update to latest version:**
```bash
docker pull printventory/printventory:latest
docker stop printventory-server
docker rm printventory-server
docker run -d --name printventory-server -p 5000:5000 -v ./data:/root/.config/Printventory --restart unless-stopped printventory/printventory:latest
```

#### Using Network Paths

When running from Docker Hub, remember:
- **Windows UNC paths** (`\\server\share\path`) won't work directly
- **Mount network shares** into the container first (see [Path Mapping Guide](#path-mapping-guide) above)
- **Use Linux-style paths** inside the container: `/mnt/network-share/path/to/file`
- **For automatic scanning**: Configure STL Home using the container path (see [STL Home Setting](#stl-home-setting) section)

#### Docker Hub Repository

The Printventory Docker image is available on Docker Hub at:
```
https://hub.docker.com/r/printventory/printventory
```

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
  -v ./data:/root/.config/Printventory \
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

### STL Home Setting

The STL Home setting allows automatic scanning of a directory on startup and periodic scanning for new files in Docker mode. This is ideal for keeping your library synchronized with a network share or mounted directory.

#### Setting STL Home in Docker Mode

There are two ways to configure STL Home in Docker:

**Option 1: Using Environment Variable (Recommended for Docker)**

You can set the STL Home directory directly in your `docker-compose.yml` using the `STL_HOME` environment variable:

```yaml
environment:
  - STL_HOME=/mnt/network-share/models
```

This will automatically configure the STL Home setting when the container starts. The setting will be visible in the Printventory web interface under **Settings → STL Home**.

**Option 2: Using the Web Interface**

1. **Ensure your files are mounted** into the container (see [Path Mapping Guide](#path-mapping-guide) above)
2. **Access the Printventory web interface** at `http://<your-server-ip>:5000` or `http://localhost:5000`
3. **Navigate to Settings → STL Home**
4. **Enter the directory path using the container path format:**
   - Use Linux-style absolute paths (e.g., `/mnt/network-share/models`)
   - The path must match a mounted volume in your Docker configuration
   - Example: If you mounted `Z:/:/mnt/network-share:ro`, use `/mnt/network-share/path/to/models`
5. **Configure the Update Frequency** (default: 60 minutes):
   - This determines how often the STL Home directory is automatically scanned for new files
   - Range: 1-1440 minutes (1 minute to 24 hours)
   - Recommended: 60-120 minutes for most use cases
6. **Click Save**

**Note**: If you set `STL_HOME` via environment variable, you can still adjust the Update Frequency through the web interface. The environment variable takes precedence for the directory path.

#### How It Works in Docker

- **On Container Startup**: When the Printventory container starts, it automatically scans the STL Home directory if one is configured
- **Periodic Scanning**: The container will automatically scan the STL Home directory at the configured interval
- **Path Requirements**: 
  - Must use Linux-style absolute paths starting with `/`
  - Path must correspond to a mounted volume in your Docker configuration
  - Example: If volume mount is `- Z:/:/mnt/network-share:ro`, use `/mnt/network-share/path` in STL Home
- **Background Scanning**: Periodic scans run in the background and won't disrupt the web interface
- **Path Validation**: Paths are validated when saved - ensure the path exists inside the container

#### Example Configuration

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  printventory:
    image: printventory/printventory:latest
    container_name: printventory-server
    ports:
      - "5000:5000"
    volumes:
      - ./data:/root/.config/Printventory
      - Z:/:/mnt/network-share:ro  # Windows mapped drive
    environment:
      - STL_HOME=/mnt/network-share/models
    restart: unless-stopped
```

**Result:**
- STL Home path is automatically set to `/mnt/network-share/models` on container startup
- The setting will be visible in **Settings → STL Home** in the web interface
- Update Frequency can be configured via the web interface (default: 60 minutes)
- This will automatically scan `Z:\models` on the Windows host (mapped to `/mnt/network-share/models` in the container) every 60 minutes (or your configured interval)

#### Clearing STL Home

To disable automatic scanning, clear the STL Home directory field and save. This will stop both startup and periodic scanning.

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

The Docker setup uses a local bind mount (`./data`) to persist your database and application data on the host filesystem. This ensures your data survives container restarts and image updates, and gives you direct access to the database files.

**Database location:**
- The database is stored in the `./data` directory (relative to your `docker-compose.yml` file)
- This directory is created automatically when you start the container
- All database files and application data are stored here

**Backup the data:**
```bash
# On Linux/Mac
tar czf printventory-backup.tar.gz -C ./data .

# On Windows (PowerShell)
Compress-Archive -Path .\data\* -DestinationPath printventory-backup.zip
```

**Restore from backup:**
```bash
# On Linux/Mac
mkdir -p ./data
tar xzf printventory-backup.tar.gz -C ./data

# On Windows (PowerShell)
Expand-Archive -Path printventory-backup.zip -DestinationPath .\data
```

**Migrating from named volume to local directory:**
If you previously used a named volume and want to migrate to the local directory:
```bash
# Stop the container
docker-compose down

# Copy data from old volume to new location
docker run --rm -v printventory-data:/source -v ${PWD}/data:/dest alpine sh -c "cp -r /source/. /dest/"

# Start with new configuration
docker-compose up -d
```

### Path Mapping Guide

Docker volumes allow you to map paths from your host machine (or network shares) into the container. Understanding this mapping is crucial for configuring Printventory to access your files.

#### Understanding Volume Mounts

Docker volume mounts use the format: `host-path:/container-path:options`

- **host-path**: The path on your host machine (or a mapped network drive)
- **/container-path**: The path inside the container where files will appear
- **options**: Mount options like `ro` (read-only) or `rw` (read-write)

**Important**: When using paths in Printventory, you must use the **container path** (`/container-path`), not the host path. The container path is what Printventory sees inside the Docker environment.

#### Quick Reference Table

| Host Path Type | Docker Volume Syntax | Container Path to Use in Printventory |
|----------------|---------------------|--------------------------------------|
| Windows mapped drive (Z:) | `- Z:/:/mnt/network-share:ro` | `/mnt/network-share/path/to/file` |
| Linux mounted SMB share | `- /mnt/network-share:/mnt/network-share:ro` | `/mnt/network-share/path/to/file` |
| Local Linux directory | `- /host/path:/mnt/models:ro` | `/mnt/models/path/to/file` |
| Windows local directory | `- C:/models:/mnt/models:ro` | `/mnt/models/path/to/file` |

#### Step-by-Step: Windows Docker Desktop

1. **Map the network share to a drive letter:**
   ```bash
   net use Z: \\server\share /persistent:yes
   ```
   This makes the network share available as drive `Z:` on Windows.

2. **Add the volume mount to docker-compose.yml:**
   ```yaml
   volumes:
     - ./data:/root/.config/Printventory
     - Z:/:/mnt/network-share:ro
   ```
   This maps Windows drive `Z:` to `/mnt/network-share` inside the container.

3. **Use the container path in Printventory:**
   - When scanning or setting STL Home, use: `/mnt/network-share/path/to/files`
   - Do not use the Windows path (`Z:\path\to\files`) or UNC path (`\\server\share\path`)

#### Step-by-Step: Linux Host

1. **Install CIFS utilities (if mounting SMB shares):**
   ```bash
   sudo apt-get update
   sudo apt-get install cifs-utils
   ```

2. **Mount the network share on the host:**
   ```bash
   sudo mkdir -p /mnt/network-share
   sudo mount -t cifs //server/share /mnt/network-share -o username=user,password=pass,uid=$(id -u),gid=$(id -g)
   ```

3. **Add the volume mount to docker-compose.yml:**
   ```yaml
   volumes:
     - ./data:/root/.config/Printventory
     - /mnt/network-share:/mnt/network-share:ro
   ```
   This maps the host mount point to the same path inside the container.

4. **Use the container path in Printventory:**
   - When scanning or setting STL Home, use: `/mnt/network-share/path/to/files`
   - The path inside the container matches the host path in this example

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
     - ./data:/root/.config/Printventory
     - /mnt/network-share:/mnt/network-share:ro
   ```

4. **Use Linux-style paths** in Printventory:
   - Format: `/mnt/network-share/path/to/files`
   - The application will automatically detect Docker and accept absolute paths

#### Option 2: Mount Local Directory

If your files are on the Docker host machine:

```yaml
volumes:
  - ./data:/root/.config/Printventory
  # Maps host /host/path/to/models to /mnt/models inside container
  - /host/path/to/models:/mnt/models:ro
```

**Usage in Printventory:**
- Use the container path: `/mnt/models/subdirectory`
- Do not use the host path (`/host/path/to/models/subdirectory`)

#### Option 3: Persistent SMB Mount (Auto-mount on boot)

To automatically mount on host reboot, add to `/etc/fstab`:

```
//server/share /mnt/network-share cifs username=user,password=pass,uid=1000,gid=1000,iocharset=utf8,file_mode=0777,dir_mode=0777 0 0
```

**Note:** When running in Docker, the application automatically detects the container environment and accepts Linux-style absolute paths (starting with `/`) instead of requiring UNC paths.

#### Troubleshooting Path Mapping Issues

**Files not found in Printventory:**
- Verify the volume mount is correct: `docker inspect printventory-server | grep -A 10 Mounts`
- Check that the container path matches what you're using in Printventory
- Ensure the host path exists and is accessible
- For network shares, verify the share is mounted on the host before starting the container

**Permission errors:**
- Check file permissions on the host: `ls -la /mnt/network-share`
- Ensure the mount includes appropriate `uid` and `gid` options for Linux mounts
- For read-only mounts, verify `:ro` flag is set if you only need read access

**Path format errors:**
- Remember: Always use the **container path** (e.g., `/mnt/network-share/path`), not the host path
- Container paths must start with `/` (Linux-style absolute paths)
- UNC paths (`\\server\share`) will not work inside Docker containers

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
- Ensure the `./data` directory has write permissions
- Check that the directory exists: `ls -la ./data` (Linux/Mac) or `dir .\data` (Windows)
- Verify the bind mount: `docker inspect printventory-server | grep -A 10 Mounts`

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

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

## Support

If you encounter any issues or have questions:
- File an issue on the GitHub repository
- Check the [GUIDE.md](GUIDE.md) for detailed usage instructions
- Join the Discord community (mentioned in the application)

## Author

**TechJeeper Designs**

---

**Note**: Always create a manual backup before uninstalling the application to preserve your data.