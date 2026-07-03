# Printventory - 3D Model Manager

Printventory is a desktop application for managing your 3D printing model collection.

## Features

### File Management
- Scan directories for STL and 3MF files (configurable size limit, default: 50MB)
- Scan ZIP archives for models (when enabled in settings)
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
- **Folder and ZIP bundles**: Models in the same subfolder or ZIP archive (2+ files) appear as one grouped row; click to preview all parts in 3D, double-click for bundle details
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
- Multiple view modes: List, Preview, and Detailed views
- Customizable model background color
- UI theme selection (modern themes available)
- Context menu for quick actions
- Responsive grid layout
- Real-time search and filtering
- Tag management system
- Auto-save changes

### Data Management
- Database backup and restore
- Purge all model data option
- Automatic thumbnail generation
- Generate missing thumbnails (separate from full regenerate)
- Regenerate all thumbnails
- Preserve metadata during rescans

### File Support
- STL files
- 3MF files (including embedded image support)
- ZIP archives (when enabled in File Type settings)
- Configurable file size limit (default: 50MB, adjustable in File Type settings)

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

### AI Features
- AI-powered tag suggestions using OpenAI or compatible APIs
- Configurable AI model selection
- Batch tagging with customizable options
- Tag merging strategies (replace, merge, append)
- Category-based tagging support
- Configurable tag limits and detail levels

### Advanced Tools
- **Print Roulette**: Randomly select models from your collection
- **Tag Manager**: Comprehensive interface for managing all tags across your collection
- **Metadata Editor**: Bulk edit metadata for multiple models at once
- **De-Dup Tool**: Find and manage duplicate files with visual comparison

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
4. (Optional) Configure settings:
   - **File Type**: Adjust max file size or enable ZIP archive support if needed
   - **Theme**: Choose your preferred UI theme and model background color
   - **Performance**: Adjust thumbnail settings for your system
   - **AI Config**: Set up AI tagging if you want automated tag suggestions
5. Start organizing your models!

## View Modes

Printventory offers three different view modes to suit your workflow:

- **List View**: Compact list showing essential information, ideal for quick browsing
- **Preview View**: Medium-sized thumbnails with basic metadata
- **Detailed View**: Large thumbnails with full metadata display, perfect for detailed review

Switch between view modes using the view controls in the interface.

## AI Tagging

AI Tagging uses artificial intelligence to automatically suggest tags for your 3D models based on their appearance and characteristics.

### Setting Up AI Tagging

1. Go to **Settings > AI Config**
2. Enter your API key (OpenAI or compatible service)
3. Select your preferred AI model
4. Configure tagging options:
   - Maximum number of tags
   - Tag merging strategy (replace, merge, or append)
   - Category-based tagging
   - Detail level
   - Concurrency settings

### Using AI Tagging

- Select one or more models
- Use the AI tagging feature from the context menu or tools
- Review and accept suggested tags
- Tags are automatically applied based on your merge strategy settings

## Settings Overview

Printventory offers comprehensive settings to customize your experience:

### AI Config
- API key and endpoint configuration
- AI model selection (GPT-4o-mini, GPT-4, etc.)
- Tag generation options (max tags, categories, detail level)
- Tag merging strategies
- Concurrency controls

### File Type
- Maximum file size limit (default: 50MB)
- Enable/disable ZIP archive scanning
- File type preferences

### Performance
- Thumbnail size settings
- Maximum concurrent renders
- Batch size for operations
- Rendering performance optimization

### Slicer Path
- Configure one or more slicer applications (name + path)
- **Open in Slicer** from the right-click context menu
- **Send to Slicer** from the 3D preview dialog (single model or full bundle)
- On macOS, each send opens a **new slicer instance** so models load even when the slicer is already open

### Bundle groups (folders and ZIP archives)

When a scan finds **two or more** STL/3MF files in the same folder or inside the same ZIP file, Printventory shows them as one **bundle** row instead of many separate entries.

| Action | Result |
|--------|--------|
| Click bundle row | Opens **3D preview** with every part laid out on a grid |
| Double-click bundle row | Opens **Bundle details** (path, sizes, print status, file list) |
| Chevron (▸ / ▾) | Expand or collapse individual files in the grid |
| **Send to Slicer** (in preview) | Sends all bundle STL/3MF files to your chosen slicer |

**Notes:**
- Single-file folders are not grouped (they stay normal model rows).
- Bundle preview supports up to 32 STL/3MF parts per open; larger bundles show the first 32 with a notice.
- ZIP entries are extracted to a temp file before sending to the slicer, same as the context menu.

### STL Home
- Set default directory for file operations
- Quick access to frequently used folders

### Theme
- UI theme selection (multiple modern themes available)
- Model background color customization
- Visual appearance preferences

## Tips

### Organization
- Use tags for easy categorization
- Enable multi-edit mode for batch operations
- Use the Tag Manager to organize and clean up tags across your collection
- Link related models using parent/child relationships
- Look for **folder** and **ZIP** bundle rows when a multi-part project was scanned together; click to preview all parts at once

### AI Tagging
- Start with a small batch to test your AI configuration
- Use "merge" strategy to combine AI tags with existing tags
- Adjust detail level based on your needs (higher detail = more specific tags)
- Review AI-suggested tags before accepting to ensure accuracy

### View Modes
- Use List view for quick scanning of large collections; bundle groups appear as one row with a part count
- Use Detailed view when reviewing models for printing
- Preview view offers a good balance between information and space

### Performance
- Adjust thumbnail size in Performance settings if rendering is slow
- Reduce concurrent renders if experiencing performance issues
- Use "Generate Missing Thumbnails" instead of full regenerate when possible

### Maintenance
- Regular backups recommended
- Use the context menu for quick actions
- Check for duplicates periodically using the De-Dup tool
- Use Print Roulette to discover forgotten models in your collection
- Purge models that no longer exist to keep your database clean 