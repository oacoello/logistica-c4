# C4 Fleet System
**C4 Fleet** (developed under the core engine *FlotaHub*) is a modular, lightweight, high-availability SPA (Single Page Application) web system specifically designed for the control, technical inventory, auditing, and maintenance management of the transportation units of the **C4 Artillery Unit of the Armed Forces of Honduras**.

---

## 🚀 Features

- **Dynamic Control Dashboard:** Immediate graphical analysis of the fleet’s operational status, category distribution, and critical metrics using `Chart.js`.
- **Detailed Technical Records:** Comprehensive registration for each unit (RHE, type, chassis, engine, drivetrain type, transmission, component-specific lubricants, and load/tank capacities).
- **Maintenance Control:** Detailed history of lubricant changes (engine, gearbox, 4x4 system, differential) and filters, including specific spare parts alerts.
- **Inspection & Printing Module:** Generation of inspection sheets optimized for physical printing, featuring clean layouts and dynamic QR code generation through `QRious`.
- **Complete Local Persistence:** Application state management (`state`) stored locally in the browser via `localStorage` to ensure data resilience in environments without constant connectivity.
- **Audit Log System:** Full traceability of critical actions executed within the system (imports, registrations, removals, maintenance operations, and data purges).
