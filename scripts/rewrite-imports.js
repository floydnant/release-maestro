#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// Function to recursively find all JS files in a directory
function findJsFiles(dir) {
    const files = []
    const items = fs.readdirSync(dir)

    for (const item of items) {
        const fullPath = path.join(dir, item)
        const stat = fs.statSync(fullPath)

        if (stat.isDirectory()) {
            files.push(...findJsFiles(fullPath))
        } else if (path.extname(item) === '.js') {
            files.push(fullPath)
        }
    }

    return files
}

// Function to rewrite imports in a JavaScript file
function rewriteImports(filePath) {
    const content = fs.readFileSync(filePath, 'utf8')

    // Replace imports from ../shared/ to ./out-tsc/shared/
    const updatedContent = content
        .replace(/\.\.\/shared\//g, './out-tsc/shared/')
        .replace(/\.\.\/package\.json/g, './package.json')

    if (content !== updatedContent) {
        fs.writeFileSync(filePath, updatedContent)
        console.log(`Updated imports in: ${filePath}`)
    }
}

// Check if the app directory exists
const appDir = 'dist/out-tsc/app'
if (!fs.existsSync(appDir)) {
    console.error(`Directory ${appDir} does not exist. Make sure to build first.`)
    process.exit(1)
}

// Find all JS files in the dist/out-tsc/app directory
const appJsFiles = findJsFiles(appDir)

console.log('Rewriting shared library imports for production bundle...')
console.log(`Found ${appJsFiles.length} JavaScript files to process`)

appJsFiles.forEach(rewriteImports)

console.log('Import rewriting complete!')
