# Overview

This is an Electron-based desktop application designed for business lead generation and email marketing automation. The application scrapes business information from online sources, manages contact lists, and sends automated emails using Gmail integration. It features a GUI for managing the scraping process, email templates, and authentication with Google services.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Desktop Application Framework
- **Electron**: Cross-platform desktop application using web technologies (HTML, CSS, JavaScript)
- **Main Process**: Handles application lifecycle and native OS interactions
- **Renderer Process**: Manages the user interface and business logic

## Data Processing
- **Excel Integration**: Uses XLSX library for reading and writing spreadsheet files
- **Business Data Scraping**: Automated extraction of business information from web sources
- **Progress Tracking**: Real-time monitoring of scraping operations with time estimation

## Email System
- **Gmail API Integration**: Direct integration with Google's email services
- **Template Management**: Dynamic email template system with variable substitution
- **Bulk Email Processing**: Automated sending of personalized emails to scraped business contacts
- **Authentication**: OAuth2 flow for secure Google account access

## User Interface Components
- **Progress Indicators**: Real-time feedback for scraping and email operations
- **Template Editor**: Built-in email template customization
- **Authentication Panel**: Google account login/logout management
- **Control Buttons**: Start/stop operations for scraping and email sending

## Session Management
- **Template Storage**: In-memory email template storage during application session
- **User State**: Persistent authentication state and user profile information
- **Process Control**: Ability to cancel ongoing operations

# External Dependencies

## Core Dependencies
- **Electron (v37.4.0)**: Desktop application framework for cross-platform compatibility
- **XLSX (v0.18.5)**: Excel file processing for importing/exporting business data

## Google Services
- **Gmail API**: For sending automated emails through user's Gmail account
- **Google OAuth2**: For secure authentication and authorization

## Web Scraping Infrastructure
- Automated business information extraction from online directories
- Real-time progress tracking and time estimation algorithms

## File System
- Local storage for temporary data processing
- Excel file import/export capabilities for business contact management