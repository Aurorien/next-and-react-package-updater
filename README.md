# Next.js & React Package Updater

Safely update Next.js and React packages across multiple projects while staying within major versions. It can be used on a local device and will run by default in current folder if not path to another folder is specified.

## Features

- Updates Next.js and React packages to latest patch/minor versions
- Never jumps major versions (no Next 15→16 or React 18→19)
- Fixes pinned versions (adds `^` to package.json)
- Git integration (pull before, commit/push after)
- Only processes relevant projects (ignores Vue, Angular, etc.)
- Recursively searches current folder and all subdirectories for package.json files (skips node_modules, .git)


## Usage
```bash
# Dry-run check in current directory without updating
node update-next-react.js

# Check and update packages
node update-next-react.js --execute

# Dry-run check specific project
node update-next-react.js path/to/project

# Check specific project and update
node update-next-react.js path/to/project --execute
```

## Examples
```bash
# Check all projects in current folder
cd ~/repos
node update-next-react.js

# Update all projects
node update-next-react.js --execute

# Check single project
cd ~/repos
node update-next-react.js alchemy-lab
```

## What it updates

- **Next.js**: Updates within any current major version
- **React**: Only updates React 19.x projects (won't touch React 18.x and lower)
- **Packages**: `next`, `react`, `react-dom`, `@types/react`, `@types/react-dom`

## Requirements

- Node.js (minimun version 14.0.0 to run the script)
- npm
