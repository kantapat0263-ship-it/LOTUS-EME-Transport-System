# **App Name**: LotusLogistics Pro

## Core Features:

- Site Management: Add, edit, and delete construction sites with name, address, GPS coordinates (picked via map click), project type tag, and active/inactive status. Sites are displayed as markers on a Google Map and can be searched/filtered.
- Vehicle & Driver Management: Register vehicles (license plate, type, max load capacity) and drivers (name, phone number), and assign drivers to vehicles.
- Smart Trip Planning & Optimization: Create new delivery trips by selecting departure, up to 10 ordered delivery stops with cargo descriptions, vehicle, and driver. Utilizes an AI-powered tool to 'Auto-Optimize Route' for the shortest total distance using Google Routes API, updating the route polyline and estimations live on a map.
- Trip Documentation & Sharing: Generate a printable delivery order (ใบงานขนส่ง) with trip details, stop list, cargo items, total distance/time, and company branding. Provides options to share as a link or generate a PDF.
- Comprehensive Trip History: View a list of all past and upcoming trips, with filtering options by date range, driver, site, and vehicle. Allows viewing detailed trip information, including map replay, and updating trip status (Planned, In Progress, Completed, Cancelled) and cargo notes.
- Interactive Dashboard & Reporting: Access an overview of today's trips and a monthly summary including total distance (for fuel reimbursement), number of trips, and most visited sites. Supports exporting reports as Excel/CSV.
- Secure Authentication & Roles: User authentication using Firebase Auth with Email/Password. Implements role-based access control (Admin, Dispatcher, Viewer) to manage application permissions.

## Style Guidelines:

- The application employs a sophisticated dark theme, anchored by a deep primary navy blue (`#172899`) to evoke professionalism and reliability, aligning with the construction industry's earnestness.
- The background utilizes a subtle, almost-black dark navy shade (`#1A1C23`), maintaining a sense of depth while allowing key information and UI elements to stand out with clarity.
- A vibrant and energetic orange (`#F0890D`) serves as the accent color, providing clear contrast for interactive elements, highlights, and calls to action, directly incorporating the user's requested brand color.
- The application uses 'Inter' (sans-serif) for all text elements. Its modern, neutral, and highly readable design ensures clarity for both technical data and general information, supporting mixed Thai and English content effectively.
- Clean, outlined icons in a consistent, modern style to clearly represent logistics, mapping, and management functionalities. Icons will be subtly colored with the accent orange for interactive states or important notifications.
- The interface follows a desktop-first design with a clear left-hand sidebar for navigation and a main content area. Crucially, the Trip Planning page will dedicate its right panel (50% width) to a consistently visible Google Map, facilitating interactive route management.
- Subtle, functional animations will be integrated for user feedback, such as route updates on the map, form submissions, and status changes. These animations will be minimal to maintain a professional and efficient user experience.