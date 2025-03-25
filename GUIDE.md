# Printventory - 3D Model Manager

Printventory is a desktop application for managing your 3D printing model collection.

## Features

### File Management
- Scan directories for STL and 3MF files (up to 50MB)
- View thumbnails of your 3D models
- Sort models by name, size, or date
- Quick access to file location
- Delete files with database cleanup
- Backup and restore database

### Model Organization
- Tag models for easy categorization
- Assign designers to models
- Track print status
- Add source URLs and notes
- Link related models (parent/child relationships)
- Assign licenses to models

### Multi-Edit Features
- Select multiple models for batch editing
- Bulk update designer, source, print status, and parent model
- Select all visible models with one click
- Filter models by various attributes

### Duplicate Management
- Find duplicate files based on content hash
- Compare duplicates with thumbnails
- Easily remove duplicate files

### Interface Features
- Customizable model background color
- Context menu for quick actions
- Responsive grid layout
- Real-time search and filtering
- Tag management system
- Auto-save changes

### Data Management
- Database backup and restore
- Purge all model data option
- Automatic thumbnail generation
- Preserve metadata during rescans

### File Support
- STL files
- 3MF files
- Size limit: 50MB per file

### Search & Filter
- Search by filename
- Filter by:
  - Designer
  - Print status
  - Tags
  - Parent model
  - License

### Metadata Features
- Track file size
- Track modification dates
- Store model thumbnails
- Track print status
- Add custom notes
- Link to source URLs

## Data Persistence
- User data is stored in `%LOCALAPPDATA%\Printventory` on Windows
- Database and thumbnails are preserved during updates
- Backups are automatically created before updates
- Manual backups can be created through the Backup/Restore menu
- **Important**: Create a manual backup before uninstalling the application

## Getting Started

1. Launch Printventory
2. Click "Select Directory" to choose your models folder
3. Wait for the initial scan to complete
4. Start organizing your models!

## Tips
- Use tags for easy categorization
- Enable multi-edit mode for batch operations
- Regular backups recommended
- Use the context menu for quick actions
- Check for duplicates periodically 