/**
 * FLOTAHUB - CORE APPLICATION ENGINE
 * 
 * Gestiona el enrutamiento de la SPA, la persistencia del estado en localStorage,
 * la lógica del Tablero con Chart.js, el filtrado y registro técnico en la Flota,
 * el ordenamiento alfanumérico para Revisiones e impresión de PDF con códigos QR,
 * y los reportes detallados de Mantenimiento.
 */

// ==========================================================================
// 1. ESTADO DE LA APLICACIÓN Y PERSISTENCIA
// ==========================================================================

let state = {
  vehicles: [],
  maintenances: [],
  inspections: [],
  auditLog: [],
  settings: {
    currency: 'HNL',
    theme: 'light',
    username: 'Administrador',
    revisionStartNumber: 1,
    revisionYearSuffix: new Date().getFullYear().toString().slice(-2)
  }
};

let authState = {
  user: null,
  sessionId: null
};

function hasPermission(permission) {
  if (!authState.user) return false;
  if (authState.user.role === 'SUPERADMIN') return true;
  return authState.user.permissions?.[permission] === true;
}

function requirePermission(permission, actionLabel = 'esta acción') {
  if (hasPermission(permission)) return true;
  alert(`Tu usuario no tiene permiso para ${actionLabel}.`);
  writeAuditLog('ERROR', `Permiso denegado: ${permission} (${actionLabel})`);
  return false;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Error HTTP ${response.status}`);
  }
  return data;
}

function showAuthGate(message = '') {
  const gate = document.getElementById('auth-gate');
  const error = document.getElementById('login-error');
  if (gate) gate.classList.remove('d-none');
  if (error && message) {
    error.textContent = message;
    error.classList.remove('d-none');
  }
}

function hideAuthGate() {
  const gate = document.getElementById('auth-gate');
  if (gate) gate.classList.add('d-none');
}

function applyAuthUi() {
  const username = authState.user?.username || authState.user?.name || 'Sin sesión';
  state.settings.username = username;

  const profileName = document.getElementById('user-profile-name');
  const roleLabel = document.getElementById('user-role-label');
  const connectionStatus = document.getElementById('connection-status');
  if (profileName) profileName.textContent = username;
  if (roleLabel) roleLabel.textContent = authState.user?.role || 'Sin sesión';
  if (connectionStatus) connectionStatus.innerHTML = '<span class="status-indicator"></span> Local';

  document.querySelectorAll('[data-requires-permission]').forEach(element => {
    const permission = element.getAttribute('data-requires-permission');
    element.disabled = !hasPermission(permission);
    element.classList.toggle('disabled', !hasPermission(permission));
  });
}

async function loadCurrentSession() {
  try {
    const session = await apiRequest('/api/session');
    authState.user = session.user;
    authState.sessionId = session.sessionId;
    hideAuthGate();
    applyAuthUi();
    return true;
  } catch {
    showAuthGate();
    return false;
  }
}

async function writeAuditLog(type, content) {
  if (!authState.user || !authState.sessionId) return;

  try {
    await apiRequest('/api/log', {
      method: 'POST',
      body: JSON.stringify({
        type,
        content,
        user: authState.user.username,
        sessionId: authState.sessionId
      })
    });
  } catch (error) {
    console.warn('No se pudo escribir el log local.', error);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeJsArg(value) {
  return JSON.stringify(String(value ?? ''));
}

function safeInlineJsArg(value) {
  return escapeHtml(safeJsArg(value));
}

function refreshIcons() {
  if (window.lucide && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

function safeJsonParse(rawValue, fallbackValue, storageKey) {
  if (!rawValue) return fallbackValue;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    console.warn(`No se pudo leer ${storageKey}; se usará un valor seguro.`, error);
    return fallbackValue;
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeNumber(value, fallbackValue = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
}

function normalizeOperatividad(value) {
  const normalizedValue = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim();

  const tokens = normalizedValue.split(/\s+/).filter(Boolean);

  if (tokens.includes('IRRECUPERABLE')) return 'Chatarra';
  if (tokens.includes('RECUPERABLE')) return 'Recuperable';
  if (tokens.includes('OPERATIVO') && !tokens.includes('INOPERATIVO')) return 'Operativo';

  return 'Operativo';
}

function normalizeVehicle(vehicle) {
  return {
    ...vehicle,
    operatividad: normalizeOperatividad(vehicle?.operatividad)
  };
}

function getFleetStats() {
  const total = state.vehicles.length;
  const operativos = state.vehicles.filter(v => normalizeOperatividad(v.operatividad) === 'Operativo').length;
  const recuperables = state.vehicles.filter(v => normalizeOperatividad(v.operatividad) === 'Recuperable').length;
  const chatarras = state.vehicles.filter(v => normalizeOperatividad(v.operatividad) === 'Chatarra').length;
  const availability = total > 0 ? Math.round((operativos / total) * 100) : 0;

  return { total, operativos, recuperables, chatarras, availability };
}

function formatMaintenanceDate(dateValue) {
  return String(dateValue || '').split('-').reverse().join('/');
}

function getMaintenanceWorkSummary(m) {
  const works = [];
  if (m.oilMotor) works.push('Aceite motor');
  if (m.oilGear) works.push('Aceite caja');
  if (m.oil4x4) works.push('Aceite transmisión 4x4');
  if (m.oilDiff) works.push('Aceite diferencial');
  if (m.other) works.push('Otros trabajos');
  return works.length ? works.join(', ') : 'Sin trabajos detallados';
}

function formatDateDDMMYYYY(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function addYears(dateValue, years) {
  const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue);
  date.setFullYear(date.getFullYear() + years);
  return date;
}

// Cargar estado inicial
function loadState() {
  const localVehicles = localStorage.getItem('flotahub_vehicles');
  const localMaintenances = localStorage.getItem('flotahub_maintenances');
  const localInspections = localStorage.getItem('flotahub_inspections');
  const localAuditLog = localStorage.getItem('flotahub_audit_logs');
  const localSettings = localStorage.getItem('flotahub_settings');

  state.settings = {
    ...state.settings,
    ...safeJsonParse(localSettings, {}, 'flotahub_settings')
  };
  applyTheme();

  if (localVehicles) {
    state.vehicles = normalizeArray(safeJsonParse(localVehicles, [], 'flotahub_vehicles')).map(normalizeVehicle);
    state.maintenances = normalizeArray(safeJsonParse(localMaintenances, [], 'flotahub_maintenances'));
    state.inspections = normalizeArray(safeJsonParse(localInspections, [], 'flotahub_inspections'));
    state.auditLog = normalizeArray(safeJsonParse(localAuditLog, [], 'flotahub_audit_logs'));
  } else {
    // Estado inicial limpio
    state.vehicles = [];
    state.maintenances = [];
    state.inspections = [];
    state.auditLog = [
      {
        id: "init-log",
        timestamp: new Date().toISOString(),
        action: "Sistema iniciado con base de datos vacía."
      }
    ];
    saveStateToStorage();
  }
}

function saveStateToStorage() {
  localStorage.setItem('flotahub_vehicles', JSON.stringify(state.vehicles));
  localStorage.setItem('flotahub_maintenances', JSON.stringify(state.maintenances));
  localStorage.setItem('flotahub_inspections', JSON.stringify(state.inspections));
  localStorage.setItem('flotahub_audit_logs', JSON.stringify(state.auditLog));
  localStorage.setItem('flotahub_settings', JSON.stringify(state.settings));
}

function applyTheme() {
  if (state.settings.theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function formatCurrency(amount) {
  const symbol = state.settings.currency === 'HNL' ? 'L. ' : '$ ';
  return symbol + (amount || 0).toLocaleString();
}

// Agregar registro de auditoría
function logAction(actionDescription) {
  const logEntry = {
    id: "log-" + Date.now(),
    timestamp: new Date().toISOString(),
    action: actionDescription
  };
  state.auditLog.unshift(logEntry); // Lo más nuevo al inicio
  saveStateToStorage();
  renderAuditLogs();
  writeAuditLog('ACTION', actionDescription);
}

// Cargar Datos de Demostración Realistas (Acción explícita del usuario)
function loadDemoData() {
  if (confirm("¿Estás seguro de que querés cargar los datos de demostración? Esto reemplazará el inventario actual con unidades reales de prueba (TOYOTA Hilux, UNIMOG, etc.).")) {
    state.vehicles = [...SEED_VEHICLES].map(normalizeVehicle);
    state.maintenances = [...SEED_MAINTENANCES];
    state.auditLog = [...SEED_AUDIT_LOG];
    state.inspections = [];
    saveStateToStorage();
    logAction("Cargada base de datos semilla con 3 vehículos de demostración reales (sin placeholders).");
    
    // Forzar actualización total de interfaces
    initDashboard();
    renderFleetTable();
    updateSelectors();
    updateCounters();
    
    alert("Datos de demostración cargados exitosamente.");
  }
}

// Limpiar historial de auditoría
function clearAuditLogs() {
  if (confirm("¿Querés limpiar el historial de cambios del sistema? Esta acción no borrará los vehículos ni mantenimientos.")) {
    state.auditLog = [
      {
        id: "clear-log-" + Date.now(),
        timestamp: new Date().toISOString(),
        action: "Historial de cambios limpiado manualmente por el usuario."
      }
    ];
    saveStateToStorage();
    renderAuditLogs();
  }
}

// ==========================================================================
// 2. ENRUTADOR DE PESTAÑAS (TAB SYSTEM)
// ==========================================================================

const tabButtons = document.querySelectorAll('.UnderlineNav-item');
const tabViews = document.querySelectorAll('.tab-view');

tabButtons.forEach(button => {
  button.addEventListener('click', () => {
    const targetViewId = button.getAttribute('data-target');
    
    // Desactivar todos los botones y vistas
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabViews.forEach(view => view.classList.remove('active'));
    
    // Activar seleccionado
    button.classList.add('active');
    document.getElementById(targetViewId).classList.add('active');
    
    // Acciones especiales al entrar a una pestaña
    if (targetViewId === 'view-dashboard') {
      initDashboard();
    } else if (targetViewId === 'view-fleet') {
      renderFleetTable();
    } else if (targetViewId === 'view-inspections') {
      renderInspectionsView();
    } else if (targetViewId === 'view-maintenance') {
      renderMaintenanceView();
    }
  });
});

// Enrutador rápido para los enlaces internos o acciones rápidas
function navigateToTab(tabId) {
  const targetBtn = document.getElementById(tabId);
  if (targetBtn) {
    targetBtn.click();
  }
}

// ==========================================================================
// 3. TABLERO DE CONTROL (DASHBOARD)
// ==========================================================================

let operatividadChartInstance = null;

function initDashboard() {
  // 1. Calcular estadísticas
  const { total, operativos, recuperables, chatarras, availability } = getFleetStats();

  updateFleetStats();
  document.getElementById('stat-fleet-availability').textContent = `${availability}%`;
  document.getElementById('stat-fleet-availability-detail').textContent = `${operativos} operativas / ${total} unidades`;

  // 2. Renderizar gráfico (Chart.js)
  renderOperatividadChart(operativos, recuperables, chatarras);

  // 3. Generar Alertas de Mantenimiento Próximo
  generateMaintenanceAlerts();

  // 4. Mostrar historial de cambios
  renderAuditLogs();
  
  // 5. Actualizar los contadores en las pestañas principales
  updateCounters();
}

function updateFleetStats() {
  const { total, operativos, recuperables, chatarras } = getFleetStats();
  const totalEl = document.getElementById('stat-total-vehicles');
  const operEl = document.getElementById('stat-operativos');
  const recEl = document.getElementById('stat-recuperables');
  const chatEl = document.getElementById('stat-chatarras');

  if (totalEl) totalEl.textContent = total;
  if (operEl) operEl.textContent = operativos;
  if (recEl) recEl.textContent = recuperables;
  if (chatEl) chatEl.textContent = chatarras;
}

function renderOperatividadChart(operativos, recuperables, chatarras) {
  if (!window.Chart) {
    console.warn('Chart.js no está disponible; se omite el gráfico de operatividad.');
    return;
  }

  const ctx = document.getElementById('operatividadChart').getContext('2d');
  const legendColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#ffffff' : '#24292f';
  
  // Si ya existe un gráfico, destruirlo para evitar superposición
  if (operatividadChartInstance) {
    operatividadChartInstance.destroy();
  }

  // Si no hay vehículos, mostrar un gráfico vacío
  if (operativos === 0 && recuperables === 0 && chatarras === 0) {
    operatividadChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Sin datos'],
        datasets: [{
          data: [100],
          backgroundColor: ['#d0d7de']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Inter', size: 12 },
              color: legendColor
            }
          }
        }
      }
    });
    return;
  }

  operatividadChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: [
        `Operativos (${operativos})`, 
        `Recuperables (${recuperables})`, 
        `Chatarras (${chatarras})`
      ],
      datasets: [{
        data: [operativos, recuperables, chatarras],
        backgroundColor: [
          '#2da44e', // Green success
          '#bf8700', // Yellow attention
          '#cf222e'  // Red danger
        ],
        borderWidth: 1,
        borderColor: '#d0d7de'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: 'Inter', size: 12 },
            color: legendColor
          }
        }
      },
      cutout: '60%'
    }
  });
}

function generateMaintenanceAlerts() {
  const alertsList = document.getElementById('alerts-list');
  const emptyAlerts = document.getElementById('maintenance-alerts');
  alertsList.innerHTML = '';
  
  let alerts = [];

  state.vehicles.forEach(vehicle => {
    // Alerta de cambio de aceite (cada 5,000 km)
    // Buscamos si tiene mantenimientos que involucren cambio de aceite de motor
    const vehicleMaint = state.maintenances.filter(m => m.vehicleId === vehicle.id && m.oilMotor);
    
    let lastOilChangeKm = 0;
    if (vehicleMaint.length > 0) {
      // Ordenar por kilometraje descendente para obtener el último
      vehicleMaint.sort((a, b) => b.km - a.km);
      lastOilChangeKm = vehicleMaint[0].km;
    }

    const kmSinceLastChange = vehicle.km - lastOilChangeKm;

    if (normalizeOperatividad(vehicle.operatividad) !== 'Chatarra') {
      if (kmSinceLastChange >= 5000) {
        alerts.push({
          type: 'danger',
          icon: 'droplet',
          vehicleId: vehicle.id,
          title: `Cambio de aceite VENCIDO: ${vehicle.rhe}`,
          description: `Han transcurrido ${kmSinceLastChange.toLocaleString()} km desde el último cambio de aceite de motor. Kilometraje actual: ${vehicle.km.toLocaleString()} km.`
        });
      } else if (kmSinceLastChange >= 4000) {
        alerts.push({
          type: 'warning',
          icon: 'alert-circle',
          vehicleId: vehicle.id,
          title: `Cambio de aceite próximo: ${vehicle.rhe}`,
          description: `Faltan ${(5000 - kmSinceLastChange).toLocaleString()} km para el cambio de aceite de motor.`
        });
      }

      // Alerta de seguro faltante
      if (!vehicle.hasInsurance) {
        alerts.push({
          type: 'warning',
          icon: 'shield-alert',
          vehicleId: vehicle.id,
          title: `Sin seguro activo: ${vehicle.rhe}`,
          description: `El vehículo no cuenta con póliza de seguro registrada.`
        });
      }
    }
  });

  if (alerts.length === 0) {
    emptyAlerts.classList.remove('d-none');
  } else {
    emptyAlerts.classList.add('d-none');
    alerts.forEach(alert => {
      const li = document.createElement('li');
      li.className = `Box-row Box-row--hover d-flex align-items-start p-3 maintenance-alert-item`;
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.setAttribute('aria-label', `Abrir ficha técnica de ${alert.title}`);
      li.addEventListener('click', () => showVehicleCard(alert.vehicleId));
      li.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showVehicleCard(alert.vehicleId);
        }
      });
      
      const badgeClass = alert.type === 'danger' ? 'bg-red-light text-red' : 'bg-yellow-light text-yellow';
      
      li.innerHTML = `
        <div class="CircleBadge CircleBadge--small ${badgeClass} mr-2">
          <i data-lucide="${escapeHtml(alert.icon)}" style="width:16px; height:16px;"></i>
        </div>
        <div class="flex-auto">
          <div class="text-bold text-small text-fg-default">${escapeHtml(alert.title)}</div>
          <div class="text-small text-muted">${escapeHtml(alert.description)}</div>
        </div>
      `;
      alertsList.appendChild(li);
    });
    refreshIcons();
  }
}

function renderAuditLogs() {
  const list = document.getElementById('audit-log-list');
  list.innerHTML = '';

  if (state.auditLog.length === 0) {
    list.innerHTML = `<li class="Box-row text-center text-muted py-4">No hay cambios registrados todavía.</li>`;
    return;
  }

  // Renderizar los últimos 15 logs
  state.auditLog.slice(0, 15).forEach(log => {
    const li = document.createElement('li');
    li.className = 'Box-row p-3';
    
    // Formatear fecha a local Rioplatense
    const date = new Date(log.timestamp);
    const dateFormatted = date.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    li.innerHTML = `
      <div class="audit-item">
        <i data-lucide="git-commit" class="text-muted flex-shrink-0 mt-1" style="width:16px; height:16px;"></i>
        <div class="flex-auto">
          <div class="text-small">${escapeHtml(log.action)}</div>
          <div class="text-mono text-small text-muted" style="font-size: 10px;">${dateFormatted}</div>
        </div>
      </div>
    `;
    list.appendChild(li);
  });
  refreshIcons();
}

function updateCounters() {
  document.getElementById('fleet-counter').textContent = state.vehicles.length;
  document.getElementById('inspections-counter').textContent = state.inspections.length;
}

// ==========================================================================
// 4. INVENTARIO (FLOTA) Y REGISTRO DE UNIDAD
// ==========================================================================

const fleetTableBody = document.getElementById('fleet-table-body');
const searchInput = document.getElementById('search-query');
const filterOperatividad = document.getElementById('filter-operatividad');
const filterTypePills = document.getElementById('filter-type-pills');
const filterBrand = document.getElementById('filter-brand');
const filterModel = document.getElementById('filter-model');
const selectedTypeFilters = new Set();
let selectedFleetStatusFilter = 'all';

// Escuchar cambios de filtros
searchInput.addEventListener('input', renderFleetTable);
filterBrand.addEventListener('change', renderFleetTable);
filterModel.addEventListener('change', renderFleetTable);
filterOperatividad.addEventListener('click', (event) => {
  const button = event.target.closest('.filter-pill');
  if (!button) return;

  selectedFleetStatusFilter = button.dataset.filter;
  filterOperatividad.querySelectorAll('.filter-pill').forEach(pill => pill.classList.toggle('active', pill === button));
  renderFleetTable();
});
filterTypePills.addEventListener('click', (event) => {
  const button = event.target.closest('.filter-pill');
  if (!button) return;

  const type = button.dataset.type;
  if (type === 'all') {
    selectedTypeFilters.clear();
  } else if (selectedTypeFilters.has(type)) {
    selectedTypeFilters.delete(type);
  } else {
    selectedTypeFilters.add(type);
  }

  syncTypePills();
  renderFleetTable();
});
document.getElementById('btn-search-clear').addEventListener('click', () => {
  searchInput.value = '';
  renderFleetTable();
});

function syncTypePills() {
  filterTypePills.querySelectorAll('.filter-pill').forEach(pill => {
    const isAll = pill.dataset.type === 'all';
    pill.classList.toggle('active', isAll ? selectedTypeFilters.size === 0 : selectedTypeFilters.has(pill.dataset.type));
  });
}

function populateFleetFilters() {
  const currentBrand = filterBrand.value;
  const currentModel = filterModel.value;
  const types = [...new Set(state.vehicles
    .map(v => String(v.type || '').trim())
    .filter(type => type && type === type.toUpperCase()))]
    .sort((a, b) => a.localeCompare(b));
  const brands = [...new Set(state.vehicles.map(v => v.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const models = [...new Set(state.vehicles
    .filter(v => !filterBrand.value || v.marca === filterBrand.value)
    .map(v => v.modelo)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b));

  filterTypePills.innerHTML = `<button type="button" class="filter-pill" data-type="all">Todos</button>` +
    types.map(type => `<button type="button" class="filter-pill" data-type="${escapeHtml(type)}">${escapeHtml(type)}</button>`).join('');
  selectedTypeFilters.forEach(type => { if (!types.includes(type)) selectedTypeFilters.delete(type); });
  syncTypePills();

  filterBrand.innerHTML = '<option value="">Todas las marcas</option>' + brands.map(brand => `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`).join('');
  filterBrand.value = brands.includes(currentBrand) ? currentBrand : '';

  filterModel.innerHTML = '<option value="">Todos los modelos</option>' + models.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
  filterModel.value = models.includes(currentModel) ? currentModel : '';
}

function renderFleetTable() {
  populateFleetFilters();
  updateFleetStats();

  const query = searchInput.value.toLowerCase().trim();
  const brandVal = filterBrand.value;
  const modelVal = filterModel.value;

  fleetTableBody.innerHTML = '';

  const filtered = state.vehicles.filter(v => {
    const matchQuery = !query || 
      v.rhe.toLowerCase().includes(query) ||
      v.marca.toLowerCase().includes(query) ||
      v.modelo.toLowerCase().includes(query) ||
      v.chasis.toLowerCase().includes(query) ||
      v.motor.toLowerCase().includes(query);

    const matchType = selectedTypeFilters.size === 0 || selectedTypeFilters.has(v.type);
    const matchBrand = !brandVal || v.marca === brandVal;
    const matchModel = !modelVal || v.modelo === modelVal;
    const normalizedOperatividad = normalizeOperatividad(v.operatividad);
    const hasMaintenance = state.maintenances.some(m => m.vehicleId === v.id);
    const matchOper = selectedFleetStatusFilter === 'all' ||
      (selectedFleetStatusFilter === 'maintenance' ? hasMaintenance : normalizedOperatividad === selectedFleetStatusFilter);

    return matchQuery && matchType && matchBrand && matchModel && matchOper;
  });

  if (filtered.length === 0) {
    fleetTableBody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted py-4">
          <i data-lucide="search" class="mb-2" style="width:24px; height:24px; stroke: #8c95a3;"></i>
          <p class="mb-0">No se encontraron unidades con los filtros especificados.</p>
        </td>
      </tr>
    `;
    refreshIcons();
    return;
  }

  filtered.forEach(v => {
    const tr = document.createElement('tr');
    tr.className = 'Box-row--hover';
    tr.style.cursor = 'pointer';

    // Determinar badge de operatividad
    const normalizedOperatividad = normalizeOperatividad(v.operatividad);
    let badgeClass = 'Label--success';
    if (normalizedOperatividad === 'Recuperable') badgeClass = 'Label--attention';
    if (normalizedOperatividad === 'Chatarra') badgeClass = 'Label--danger';

    tr.innerHTML = `
      <td class="text-bold text-mono">${escapeHtml(v.rhe)}</td>
      <td>${escapeHtml(v.type)}</td>
      <td>
        <span class="text-bold text-blue">${escapeHtml(v.marca)}</span>
        <span class="text-muted d-block text-small">${escapeHtml(v.modelo)}</span>
      </td>
      <td class="text-mono text-small">
        C: ${escapeHtml(v.chasis)}<br>
        M: ${escapeHtml(v.motor)}
      </td>
      <td>${escapeHtml(v.year)}</td>
      <td><span class="Label ${badgeClass}">${escapeHtml(normalizedOperatividad)}</span></td>
      <td class="text-right" onclick="event.stopPropagation();">
        <div class="d-flex gap-2 justify-content-end">
          <button class="btn btn-sm" onclick="showVehicleCard(${safeInlineJsArg(v.id)})" title="Ver Ficha Técnica">
            <i data-lucide="eye" style="width:14px; height:14px;"></i>
          </button>
          <button class="btn btn-sm" onclick="openMaintenanceModal(${safeInlineJsArg(v.id)})" title="Reportar Mantenimiento">
            <i data-lucide="wrench" style="width:14px; height:14px;"></i>
          </button>
          <button class="btn btn-sm" onclick="editVehicle(${safeInlineJsArg(v.id)})" title="Editar">
            <i data-lucide="edit" style="width:14px; height:14px;"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteVehicle(${safeInlineJsArg(v.id)})" title="Eliminar">
            <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
          </button>
        </div>
      </td>
    `;
    
    // Al hacer clic en cualquier parte de la fila, abre la Ficha Técnica (excepto botones de acción)
    tr.addEventListener('click', () => {
      showVehicleCard(v.id);
    });

    fleetTableBody.appendChild(tr);
  });
  refreshIcons();
}

// Sub-pestañas del Formulario del Vehículo (Modal)
const formTabs = document.querySelectorAll('.tabnav-tab');
const formSections = document.querySelectorAll('.form-section');

formTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    // Activar pestaña visualmente
    formTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Cambiar sección de inputs activa
    formSections.forEach(s => s.classList.remove('active'));
    
    if (tab.id === 'form-tab-general') {
      document.getElementById('sec-general').classList.add('active');
    } else if (tab.id === 'form-tab-technical') {
      document.getElementById('sec-technical').classList.add('active');
    } else if (tab.id === 'form-tab-acquisition') {
      document.getElementById('sec-acquisition').classList.add('active');
    }
  });
});

// Toggle campos de seguro
const insuranceCheckbox = document.getElementById('v-has-insurance');
const insuranceFields = document.getElementById('insurance-fields');

insuranceCheckbox.addEventListener('change', () => {
  if (insuranceCheckbox.checked) {
    insuranceFields.classList.remove('d-none');
    document.getElementById('v-insurance-co').setAttribute('required', 'true');
    document.getElementById('v-insurance-num').setAttribute('required', 'true');
    document.getElementById('v-insurance-value').setAttribute('required', 'true');
  } else {
    insuranceFields.classList.add('d-none');
    document.getElementById('v-insurance-co').removeAttribute('required');
    document.getElementById('v-insurance-num').removeAttribute('required');
    document.getElementById('v-insurance-value').removeAttribute('required');
  }
});

// Guardar/Crear Vehículo
const vehicleForm = document.getElementById('form-vehicle');
const vehicleModalAlert = document.getElementById('modal-vehicle-alert');

vehicleForm.addEventListener('submit', (e) => {
  e.preventDefault();
  vehicleModalAlert.classList.add('d-none');

  const idEdit = document.getElementById('vehicle-id-edit').value;
  const rhe = document.getElementById('v-rhe').value.trim().toUpperCase();

  // Validaciones
  if (!rhe) {
    showFormError("RHE es un campo requerido.");
    return;
  }

  // Verificar RHE duplicado (excepto si estamos editando el mismo)
  const isDuplicate = state.vehicles.some(v => v.rhe === rhe && v.id !== idEdit);
  if (isDuplicate) {
    showFormError(`Ya existe una unidad de flota registrada con el RHE: ${rhe}`);
    return;
  }

  // Construir objeto vehículo desde inputs
  const vehicleData = {
    id: idEdit || "v-" + Date.now(),
    rhe: rhe,
    type: document.getElementById('v-type').value,
    marca: document.getElementById('v-marca').value,
    modelo: document.getElementById('v-modelo').value.trim(),
    color: document.getElementById('v-color').value.trim(),
    chasis: document.getElementById('v-chasis').value.trim().toUpperCase(),
    motor: document.getElementById('v-motor').value.trim().toUpperCase(),
    year: parseInt(document.getElementById('v-year').value),
    operatividad: normalizeOperatividad(document.getElementById('v-operatividad').value),
    categoria: document.getElementById('v-categoria').value,
    situacion: document.getElementById('v-situacion').value.trim(),

    // Especificaciones técnicas
    km: parseInt(document.getElementById('v-km').value) || 0,
    engineSize: parseInt(document.getElementById('v-engine-size').value) || 0,
    cylinders: parseInt(document.getElementById('v-cylinders').value) || 0,
    hp: parseInt(document.getElementById('v-hp').value) || 0,
    traction: document.getElementById('v-traction').value,
    transmission: document.getElementById('v-transmission').value,
    cabin: document.getElementById('v-cabin').value,
    cabinOther: document.getElementById('v-cabin-other').value.trim(),
    fuel: document.getElementById('v-fuel').value,
    oilMotor: document.getElementById('v-oil-motor').value.trim(),
    oilGear: document.getElementById('v-oil-gear').value.trim(),
    oil4x4: document.getElementById('v-oil-4x4').value.trim(),
    oilDiff: document.getElementById('v-oil-diff').value.trim(),
    filterAir: document.getElementById('v-filter-air').value.trim().toUpperCase(),
    filterFuel: document.getElementById('v-filter-fuel').value.trim().toUpperCase(),
    tanks: parseInt(document.getElementById('v-tanks').value) || 1,
    tankCap: parseInt(document.getElementById('v-tank-cap').value) || 0,
    autoHwy: parseFloat(document.getElementById('v-auto-hwy').value) || 0,
    autoMix: parseFloat(document.getElementById('v-auto-mix').value) || 0,
    tyreNum: parseInt(document.getElementById('v-tyre-num').value) || 4,
    rin: document.getElementById('v-rin').value.trim(),
    speeds: parseInt(document.getElementById('v-speeds').value) || 5,
    load: parseInt(document.getElementById('v-load').value) || 0,
    passengersEq: parseInt(document.getElementById('v-passengers-eq').value) || 0,
    passengersNoEq: parseInt(document.getElementById('v-passengers-noeq').value) || 0,

    // Adquisición y seguro
    acquisition: document.getElementById('v-acquisition').value,
    acquisitionOther: document.getElementById('v-acquisition-other').value.trim(),
    value: parseInt(document.getElementById('v-value').value) || 0,
    hasInsurance: insuranceCheckbox.checked,
    insuranceCo: insuranceCheckbox.checked ? document.getElementById('v-insurance-co').value.trim() : "",
    insuranceNum: insuranceCheckbox.checked ? document.getElementById('v-insurance-num').value.trim().toUpperCase() : "",
    insuranceValue: insuranceCheckbox.checked ? (parseInt(document.getElementById('v-insurance-value').value) || 0) : 0,

    observations: document.getElementById('v-observations').value.trim()
  };

  if (idEdit) {
    // Actualizar vehículo existente
    const idx = state.vehicles.findIndex(v => v.id === idEdit);
    if (idx !== -1) {
      state.vehicles[idx] = vehicleData;
      logAction(`Vehículo ${vehicleData.type} [${vehicleData.rhe}] modificado y actualizado en el sistema.`);
    }
  } else {
    // Agregar nuevo vehículo
    state.vehicles.push(vehicleData);
    logAction(`Vehículo ${vehicleData.type} [${vehicleData.rhe}] registrado y guardado exitosamente en el inventario.`);
  }

  saveStateToStorage();
  closeModal('modal-vehicle');
  
  // Refrescar vistas
  renderFleetTable();
  initDashboard();
  updateSelectors();
  updateCounters();
});

function showFormError(msg) {
  vehicleModalAlert.textContent = msg;
  vehicleModalAlert.classList.remove('d-none');
  vehicleModalAlert.scrollIntoView({ behavior: 'smooth' });
}

// Abrir modal de Agregar Unidad
document.getElementById('btn-add-vehicle').addEventListener('click', () => openVehicleModal());
document.getElementById('quick-add-vehicle').addEventListener('click', () => openVehicleModal());

function openVehicleModal(vehicleId = null) {
  vehicleForm.reset();
  document.getElementById('vehicle-id-edit').value = '';
  document.getElementById('modal-vehicle-title').textContent = "Ingresar Nueva Unidad de Flota";
  vehicleModalAlert.classList.add('d-none');
  insuranceFields.classList.add('d-none');

  // Asegurar que abrimos en la pestaña 1 del formulario
  document.getElementById('form-tab-general').click();

  if (vehicleId) {
    const v = state.vehicles.find(item => item.id === vehicleId);
    if (v) {
      document.getElementById('vehicle-id-edit').value = v.id;
      document.getElementById('modal-vehicle-title').textContent = `Editar Unidad: ${v.rhe}`;

      // Llenar campos generales
      document.getElementById('v-rhe').value = v.rhe;
      document.getElementById('v-type').value = v.type;
      document.getElementById('v-marca').value = v.marca;
      document.getElementById('v-modelo').value = v.modelo;
      document.getElementById('v-color').value = v.color || '';
      document.getElementById('v-chasis').value = v.chasis;
      document.getElementById('v-motor').value = v.motor;
      document.getElementById('v-year').value = v.year;
      document.getElementById('v-operatividad').value = normalizeOperatividad(v.operatividad);
      document.getElementById('v-categoria').value = v.categoria;
      document.getElementById('v-situacion').value = v.situacion;

      // Llenar especificaciones técnicas
      document.getElementById('v-km').value = v.km;
      document.getElementById('v-engine-size').value = v.engineSize;
      document.getElementById('v-cylinders').value = v.cylinders;
      document.getElementById('v-hp').value = v.hp;
      document.getElementById('v-traction').value = v.traction;
      document.getElementById('v-transmission').value = v.transmission;
      document.getElementById('v-cabin').value = v.cabin;
      document.getElementById('v-cabin-other').value = v.cabinOther;
      document.getElementById('v-fuel').value = v.fuel;
      document.getElementById('v-oil-motor').value = v.oilMotor;
      document.getElementById('v-oil-gear').value = v.oilGear;
      document.getElementById('v-oil-4x4').value = v.oil4x4;
      document.getElementById('v-oil-diff').value = v.oilDiff;
      document.getElementById('v-filter-air').value = v.filterAir;
      document.getElementById('v-filter-fuel').value = v.filterFuel;
      document.getElementById('v-tanks').value = v.tanks;
      document.getElementById('v-tank-cap').value = v.tankCap;
      document.getElementById('v-auto-hwy').value = v.autoHwy;
      document.getElementById('v-auto-mix').value = v.autoMix;
      document.getElementById('v-tyre-num').value = v.tyreNum;
      document.getElementById('v-rin').value = v.rin;
      document.getElementById('v-speeds').value = v.speeds;
      document.getElementById('v-load').value = v.load;
      document.getElementById('v-passengers-eq').value = v.passengersEq;
      document.getElementById('v-passengers-noeq').value = v.passengersNoEq;

      // Adquisición y seguro
      document.getElementById('v-acquisition').value = v.acquisition;
      document.getElementById('v-acquisition-other').value = v.acquisitionOther;
      document.getElementById('v-value').value = v.value;

      insuranceCheckbox.checked = v.hasInsurance;
      if (v.hasInsurance) {
        insuranceFields.classList.remove('d-none');
        document.getElementById('v-insurance-co').value = v.insuranceCo;
        document.getElementById('v-insurance-num').value = v.insuranceNum;
        document.getElementById('v-insurance-value').value = v.insuranceValue;
      }

      document.getElementById('v-observations').value = v.observations;
    }
  }

  openModal('modal-vehicle');
}

function deleteVehicle(vehicleId) {
  const v = state.vehicles.find(item => item.id === vehicleId);
  if (v) {
    if (confirm(`¿Estás seguro de que querés ELIMINAR el vehículo ${v.type} con placa ${v.rhe}? Esta acción no se puede deshacer.`)) {
      state.vehicles = state.vehicles.filter(item => item.id !== vehicleId);
      // Limpiar también sus mantenimientos asociados
      state.maintenances = state.maintenances.filter(m => m.vehicleId !== vehicleId);
      
      logAction(`Vehículo ${v.type} [${v.rhe}] y sus reportes técnicos asociados eliminados permanentemente del sistema.`);
      saveStateToStorage();
      
      renderFleetTable();
      initDashboard();
      updateSelectors();
      updateCounters();
      
      // Cerrar modal de ficha detallada si estaba abierta
      closeModal('modal-card');
    }
  }
}

function editVehicle(vehicleId) {
  closeModal('modal-card');
  openVehicleModal(vehicleId);
}

// ==========================================================================
// 5. FICHA TÉCNICA DETALLADA (CARD VIEW INTERACTIVA)
// ==========================================================================

function showVehicleCard(vehicleId) {
  const v = state.vehicles.find(item => item.id === vehicleId);
  if (!v) return;

  const modalContent = document.getElementById('card-content');
  
  // Badges superiores
  const normalizedOperatividad = normalizeOperatividad(v.operatividad);
  let stateBadge = `<span class="Label Label--success">Operativo</span>`;
  if (normalizedOperatividad === 'Recuperable') stateBadge = `<span class="Label Label--attention">Recuperable</span>`;
  if (normalizedOperatividad === 'Chatarra') stateBadge = `<span class="Label Label--danger">Chatarra</span>`;

  let catBadge = `<span class="Label bg-subtle text-muted">Táctico</span>`;
  if (v.categoria === 'Administrativo') catBadge = `<span class="Label text-blue" style="background-color: var(--color-accent-subtle); border-color: var(--color-accent-border);">Administrativo</span>`;
  if (v.categoria === 'Combate') catBadge = `<span class="Label text-red" style="background-color: var(--color-danger-subtle); border-color: var(--color-danger-border);">Combate</span>`;

  // Renderizar datos del seguro
  let seguroHTML = `<span class="Label Label--danger"><i data-lucide="shield-off" class="mr-1"></i> No cuenta con póliza activa</span>`;
  if (v.hasInsurance) {
    seguroHTML = `
      <div class="flash flash-success p-3 text-small">
        <span class="text-bold d-block mb-1 text-green"><i data-lucide="shield" class="mr-1"></i> Seguro Activo</span>
        <div class="row">
          <div class="col-6">
            <strong>Aseguradora:</strong> ${escapeHtml(v.insuranceCo)}<br>
            <strong>Número de Póliza:</strong> <span class="text-mono">${escapeHtml(v.insuranceNum)}</span>
          </div>
          <div class="col-6">
            <strong>Valor Asegurado:</strong> ${formatCurrency(v.insuranceValue)}
          </div>
        </div>
      </div>
    `;
  }

  // Botón especial para generar revisión inmediata
  let btnRevisionInmediata = '';
  if (normalizedOperatividad !== 'Chatarra') {
    btnRevisionInmediata = `
      <button class="btn btn-sm btn-outline-purple w-full mt-3" onclick="emitSingleRevision(${safeInlineJsArg(v.id)})">
        <i data-lucide="file-signature" class="mr-1"></i> Emitir Hoja de Revisión Inmediata
      </button>
    `;
  } else {
    btnRevisionInmediata = `
      <div class="flash flash-warn p-2 text-center text-small mt-3">
        <strong>Excluido de revisión:</strong> Las unidades chatarra no pueden emitir reportes de inspección.
      </div>
    `;
  }

  const vehicleMaintenances = state.maintenances.filter(m => m.vehicleId === v.id);
  const maintenanceHistoryHTML = vehicleMaintenances.length ? `
    <ul class="Box-row-list">
      ${vehicleMaintenances.map(m => `
        <li class="Box-row maintenance-history-item" onclick="showMaintenanceDetail(${safeInlineJsArg(m.id)})" tabindex="0">
          <div class="d-flex justify-content-between gap-2">
            <strong>${escapeHtml(formatMaintenanceDate(m.date))} · ${escapeHtml(Number(m.km || 0).toLocaleString())} km</strong>
            <span class="Label">Ver detalle</span>
          </div>
          <div class="text-small text-muted mt-1">${escapeHtml(getMaintenanceWorkSummary(m))}</div>
        </li>
      `).join('')}
    </ul>
  ` : '<div class="blankslate p-4 text-center text-muted">No hay mantenimientos registrados para esta unidad.</div>';

  modalContent.innerHTML = `
    <div class="tabnav mb-3">
      <nav class="tabnav-tabs card-tabs" aria-label="Secciones de ficha técnica">
        <button type="button" class="tabnav-tab active" data-card-tab="identificacion">1. Identificación y Ubicación</button>
        <button type="button" class="tabnav-tab" data-card-tab="mecanica">2. Mecánica y Lubricantes</button>
        <button type="button" class="tabnav-tab" data-card-tab="adquisicion">3. Adquisición y Seguro</button>
        <button type="button" class="tabnav-tab" data-card-tab="observaciones">4. Observaciones</button>
        <button type="button" class="tabnav-tab" data-card-tab="historial">5. Historial de Mantenimiento</button>
      </nav>
    </div>

    <section class="card-tab-panel active" data-card-panel="identificacion">
      <h4 class="card-section-title">Identificación y Ubicación</h4>
      <ul class="spec-list mb-3">
        <li class="spec-item"><span class="spec-label">RHE (Placa)</span><span class="spec-val text-mono text-bold">${escapeHtml(v.rhe)}</span></li>
        <li class="spec-item"><span class="spec-label">Tipo</span><span class="spec-val">${escapeHtml(v.type)}</span></li>
        <li class="spec-item"><span class="spec-label">Marca / Modelo</span><span class="spec-val text-bold">${escapeHtml(v.marca)} / ${escapeHtml(v.modelo)}</span></li>
        <li class="spec-item"><span class="spec-label">Color</span><span class="spec-val">${escapeHtml(v.color || 'N/A')}</span></li>
        <li class="spec-item"><span class="spec-label">No. Chasis (VIN)</span><span class="spec-val text-mono">${escapeHtml(v.chasis)}</span></li>
        <li class="spec-item"><span class="spec-label">No. Motor</span><span class="spec-val text-mono">${escapeHtml(v.motor)}</span></li>
        <li class="spec-item"><span class="spec-label">Año de Fabricación</span><span class="spec-val">${escapeHtml(v.year)}</span></li>
        <li class="spec-item"><span class="spec-label">Categoría</span><span class="spec-val">${escapeHtml(v.categoria)}</span></li>
        <li class="spec-item"><span class="spec-label">Situación</span><span class="spec-val">${escapeHtml(v.situacion)}</span></li>
      </ul>
      <div class="Box p-3 bg-subtle card-qr-box">
        <h4 class="m-0 mb-2 font-size-13 font-weight-bold">Código QR Técnico</h4>
        <div class="d-flex flex-column align-items-center bg-white p-3 border-default rounded-3">
          <canvas id="card-qr-canvas"></canvas>
          <span class="text-mono text-muted text-center d-block mt-2" style="font-size:9px; line-height:1.2;">Escanear para verificar la<br>ficha de inventario física</span>
        </div>
        ${btnRevisionInmediata}
      </div>
    </section>

    <section class="card-tab-panel" data-card-panel="mecanica">
      <h4 class="card-section-title">Especificaciones Mecánicas</h4>
      <div class="card-grid mb-3">
        <ul class="spec-list">
          <li class="spec-item"><span class="spec-label">Kilometraje</span><span class="spec-val">${escapeHtml(v.km.toLocaleString())} km</span></li>
          <li class="spec-item"><span class="spec-label">Tamaño Motor</span><span class="spec-val">${escapeHtml(v.engineSize)} cc</span></li>
          <li class="spec-item"><span class="spec-label">Cilindros</span><span class="spec-val">${escapeHtml(v.cylinders)}</span></li>
          <li class="spec-item"><span class="spec-label">Potencia (HP)</span><span class="spec-val">${escapeHtml(v.hp)} HP</span></li>
          <li class="spec-item"><span class="spec-label">Tracción</span><span class="spec-val">${escapeHtml(v.traction)}</span></li>
          <li class="spec-item"><span class="spec-label">Transmisión</span><span class="spec-val">${escapeHtml(v.transmission)}</span></li>
        </ul>
        <ul class="spec-list">
          <li class="spec-item"><span class="spec-label">Combustible</span><span class="spec-val">${escapeHtml(v.fuel)}</span></li>
          <li class="spec-item"><span class="spec-label">Capacidad de Carga</span><span class="spec-val">${escapeHtml(v.load.toLocaleString())} lbs</span></li>
          <li class="spec-item"><span class="spec-label">Pasajeros c/ Equipo</span><span class="spec-val">${escapeHtml(v.passengersEq)}</span></li>
          <li class="spec-item"><span class="spec-label">Pasajeros s/ Equipo</span><span class="spec-val">${escapeHtml(v.passengersNoEq)}</span></li>
          <li class="spec-item"><span class="spec-label">Cantidad Tanques</span><span class="spec-val">${escapeHtml(v.tanks)}</span></li>
          <li class="spec-item"><span class="spec-label">Capacidad Tanque</span><span class="spec-val">${escapeHtml(v.tankCap)} gal</span></li>
        </ul>
      </div>
      <h4 class="card-section-title">Lubricantes y Filtros de Repuesto</h4>
      <ul class="spec-list">
        <li class="spec-item"><span class="spec-label">Aceite de Motor</span><span class="spec-val text-mono">${escapeHtml(v.oilMotor)}</span></li>
        <li class="spec-item"><span class="spec-label">Aceite de Caja</span><span class="spec-val text-mono">${escapeHtml(v.oilGear)}</span></li>
        <li class="spec-item"><span class="spec-label">Aceite Transmisión 4x4</span><span class="spec-val text-mono">${escapeHtml(v.oil4x4 || 'N/A')}</span></li>
        <li class="spec-item"><span class="spec-label">Aceite de Diferencial</span><span class="spec-val text-mono">${escapeHtml(v.oilDiff)}</span></li>
        <li class="spec-item"><span class="spec-label">Filtro de Aire</span><span class="spec-val text-mono text-bold">${escapeHtml(v.filterAir)}</span></li>
        <li class="spec-item"><span class="spec-label">Filtro de Combustible</span><span class="spec-val text-mono text-bold">${escapeHtml(v.filterFuel)}</span></li>
        <li class="spec-item"><span class="spec-label">Número Llanta / Rin</span><span class="spec-val text-mono">Llanta: ${escapeHtml(v.tyreNum)} / Rin: ${escapeHtml(v.rin)}</span></li>
      </ul>
    </section>

    <section class="card-tab-panel" data-card-panel="adquisicion">
      <h4 class="card-section-title">Datos de Adquisición</h4>
      <ul class="spec-list mb-3">
        <li class="spec-item"><span class="spec-label">Forma Adquisición</span><span class="spec-val">${escapeHtml(v.acquisition === 'Otros Convenios' ? v.acquisitionOther : v.acquisition)}</span></li>
        <li class="spec-item"><span class="spec-label">Valor Adquisición</span><span class="spec-val text-bold">$ ${escapeHtml(v.value.toLocaleString())} USD</span></li>
      </ul>
      <h4 class="card-section-title">Estado de Seguro</h4>
      ${seguroHTML}
    </section>

    <section class="card-tab-panel" data-card-panel="observaciones">
      <h4 class="card-section-title">Observaciones de la Unidad</h4>
      <div class="Box p-3 bg-subtle text-small italic">${escapeHtml(v.observations || 'Sin observaciones registradas en el inventario.')}</div>
    </section>

    <section class="card-tab-panel" data-card-panel="historial">
      <h4 class="card-section-title">Historial de Mantenimiento</h4>
      ${maintenanceHistoryHTML}
    </section>
  `;

  modalContent.querySelectorAll('[data-card-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.cardTab;
      modalContent.querySelectorAll('[data-card-tab]').forEach(t => t.classList.remove('active'));
      modalContent.querySelectorAll('[data-card-panel]').forEach(panel => panel.classList.remove('active'));
      tab.classList.add('active');
      modalContent.querySelector(`[data-card-panel="${target}"]`).classList.add('active');
    });
  });

  // Actualizar botones de acción del modal
  document.getElementById('btn-delete-vehicle-card').setAttribute('onclick', `deleteVehicle(${safeJsArg(v.id)})`);
  document.getElementById('btn-edit-vehicle-card').setAttribute('onclick', `editVehicle(${safeJsArg(v.id)})`);
  document.getElementById('btn-maintenance-vehicle-card').setAttribute('onclick', `openMaintenanceModal(${safeJsArg(v.id)})`);

  // Mostrar modal de Ficha
  openModal('modal-card');
  refreshIcons();

  // Generar QR de ficha técnica inmediatamente
  // El QR debe contener un resumen estructurado para cumplir estrictamente con "El QR debe mostrar la información de la ficha tecnica del vehiculo."
  const qrDataText = `FLOTAHUB - CONTROL DE FLOTA
------------------------------
RHE (PLACA): ${v.rhe}
TIPO: ${v.type}
MARCA/MODELO: ${v.marca} ${v.modelo}
AÑO: ${v.year} | CATEGORÍA: ${v.categoria}
CHASIS: ${v.chasis}
MOTOR: ${v.motor}
ESTADO: ${normalizedOperatividad}
KILOMETRAJE: ${escapeHtml(v.km.toLocaleString())} km
MOTOR CC: ${escapeHtml(v.engineSize)} cc | HP: ${v.hp}
ACEITE MOTOR: ${v.oilMotor}
FILTRO AIRE: ${v.filterAir}
FILTRO COMBUSTIBLE: ${v.filterFuel}
ADQUISICIÓN: ${v.acquisition} (${v.acquisitionOther || 'N/A'})
SEGURO: ${v.hasInsurance ? `${v.insuranceCo} (${v.insuranceNum})` : 'NO TIENE'}
VALOR: $ ${escapeHtml(v.value.toLocaleString())} USD
------------------------------
SITUACIÓN: ${v.situacion}
OBSERVACIONES: ${v.observations || 'Ninguna'}`;

  setTimeout(() => {
    const qrCanvas = document.getElementById('card-qr-canvas');
    if (window.QRious && qrCanvas) {
      new QRious({
        element: qrCanvas,
        value: qrDataText,
        size: 150,
        level: 'M'
      });
    } else {
      console.warn('QRious no está disponible; se omite el QR de ficha técnica.');
    }

    // Añadir simulador interactivo para que al hacer clic en el QR en pantalla, muestre lo que lee
    if (!qrCanvas) return;
    qrCanvas.style.cursor = 'zoom-in';
    qrCanvas.addEventListener('click', () => {
      simulateQrScan(qrDataText, v.id);
    });
  }, 100);
}

// Simulador de escáner QR físico (apertura y lectura de datos)
function simulateQrScan(qrText, vehicleId) {
  document.getElementById('qr-scan-data').textContent = qrText;
  document.getElementById('btn-open-scanned-vehicle').setAttribute('onclick', `showVehicleCard(${safeJsArg(vehicleId)}); closeModal('modal-qr-scanner');`);
  openModal('modal-qr-scanner');
  refreshIcons();
}

// Emisión rápida de revisión para una sola unidad seleccionada
function emitSingleRevision(vehicleId) {
  closeModal('modal-card');
  navigateToTab('tab-inspections');
  
  // Desmarcar todo
  const checkboxes = document.querySelectorAll('.vehicle-check-item');
  checkboxes.forEach(cb => cb.checked = false);

  // Marcar la seleccionada
  const targetCb = document.getElementById(`cb-v-${vehicleId}`);
  if (targetCb) {
    targetCb.checked = true;
    targetCb.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ==========================================================================
// 6. GENERAL REVISIONES (INSPECCIÓN Y QR IMPRIMIBLE)
// ==========================================================================

const vehicleCheckboxList = document.getElementById('vehicle-checkbox-list');

function renderInspectionsView() {
  // Sincronizar UI con configuraciones
  if (document.getElementById('inspection-start-number')) {
    document.getElementById('inspection-start-number').value = state.settings.revisionStartNumber;
  }
  if (document.getElementById('inspection-year-suffix')) {
    document.getElementById('inspection-year-suffix').value = state.settings.revisionYearSuffix;
  }

  // Re-listar los vehículos aptos (Operativos o Recuperables)
  vehicleCheckboxList.innerHTML = '';
  
  // Excluir Chatarra del listado de revisiones
  const validVehicles = state.vehicles.filter(v => normalizeOperatividad(v.operatividad) !== 'Chatarra');

  if (validVehicles.length === 0) {
    vehicleCheckboxList.innerHTML = `<div class="p-3 text-center text-muted">No hay vehículos válidos (Operativos o Recuperables) en el inventario.</div>`;
    return;
  }

  // ORDENAMIENTO ALFANUMÉRICO DE MENOR A MAYOR SEGÚN EL RHE (PLACA)
  // Regla crítica: "El orden de registro XXXXX-26 sería de menor a mayor en el RHE (Placa)."
  validVehicles.sort((a, b) => a.rhe.localeCompare(b.rhe, undefined, { numeric: true, sensitivity: 'base' }));

  validVehicles.forEach(v => {
    const div = document.createElement('div');
    div.className = 'Box-row Box-row--hover d-flex align-items-center py-2 px-3';
    
    const normalizedOperatividad = normalizeOperatividad(v.operatividad);
    let operBadge = `<span class="Label Label--success ml-2">Operativo</span>`;
    if (normalizedOperatividad === 'Recuperable') operBadge = `<span class="Label Label--attention ml-2">Recuperable</span>`;

    div.innerHTML = `
      <label class="d-flex align-items-center flex-auto style-none cursor-pointer" for="cb-v-${escapeHtml(v.id)}">
        <input type="checkbox" id="cb-v-${escapeHtml(v.id)}" class="vehicle-check-item mr-2" value="${escapeHtml(v.id)}">
        <div class="flex-auto">
          <span class="text-bold text-mono">${escapeHtml(v.rhe)}</span> - ${escapeHtml(v.marca)} ${escapeHtml(v.modelo)}
          ${operBadge}
        </div>
      </label>
    `;
    vehicleCheckboxList.appendChild(div);
  });

  // Botones de selección masiva
  document.getElementById('btn-select-all-vehicles').onclick = () => {
    document.querySelectorAll('.vehicle-check-item').forEach(cb => cb.checked = true);
  };
  document.getElementById('btn-deselect-all-vehicles').onclick = () => {
    document.querySelectorAll('.vehicle-check-item').forEach(cb => cb.checked = false);
  };

  renderInspectionsHistory();
}

function renderInspectionsHistory() {
  const historyList = document.getElementById('inspections-history-list');
  historyList.innerHTML = '';

  if (state.inspections.length === 0) {
    historyList.innerHTML = `<li class="Box-row text-center text-muted py-4">No se han emitido revisiones aún.</li>`;
    return;
  }

  state.inspections.forEach(ins => {
    const li = document.createElement('li');
    li.className = 'Box-row d-flex align-items-center justify-content-between p-3';
    
    const date = new Date(ins.timestamp);
    const dateFormatted = date.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    li.innerHTML = `
      <div>
        <div class="text-bold text-blue d-flex align-items-center">
          <i data-lucide="file-text" class="mr-1" style="width:16px; height:16px;"></i>
          Conjunto de Revisiones #${escapeHtml(ins.startOrder)}-${escapeHtml(ins.endOrder)}
        </div>
        <div class="text-small text-muted">
          Emitido el ${escapeHtml(dateFormatted)} • Unidades inspeccionadas: ${escapeHtml((ins.vehicleRhes || []).join(', '))}
        </div>
      </div>
      <button class="btn btn-sm" onclick="reprintInspectionBatch(${safeInlineJsArg(ins.id)})">
        <i data-lucide="printer" class="mr-1"></i> Reimprimir Lote
      </button>
    `;
    historyList.appendChild(li);
  });
  refreshIcons();
}

// Procesar formulario de emisión en lote
const inspectionsForm = document.getElementById('form-generate-inspections');

inspectionsForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const startNumInput = state.settings.revisionStartNumber;
  const yearSuffix = state.settings.revisionYearSuffix;

  // Obtener seleccionados
  const checkedBoxes = document.querySelectorAll('.vehicle-check-item:checked');
  const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);

  if (selectedIds.length === 0) {
    alert("Por favor, selecciona al menos una unidad para emitir las revisiones.");
    return;
  }

  // Filtrar objetos vehículos reales correspondientes
  const vehiclesToInspect = state.vehicles.filter(v => selectedIds.includes(v.id));

  // ORDENAR DE MENOR A MAYOR SEGÚN EL RHE (PLACA) ANTES DE ASIGNAR CONSECUTIVOS
  vehiclesToInspect.sort((a, b) => a.rhe.localeCompare(b.rhe, undefined, { numeric: true, sensitivity: 'base' }));

  // Generar conjunto de revisiones
  let currentNum = startNumInput;
  const inspectionSheetsData = [];
  const vehicleRhes = [];

  vehiclesToInspect.forEach(v => {
    // Formato XXXXX-26 (ej: 00170-26)
    const formattedOrder = String(currentNum).padStart(5, '0') + `-${yearSuffix}`;
    
    inspectionSheetsData.push({
      orderNumber: formattedOrder,
      vehicle: v
    });

    vehicleRhes.push(v.rhe);
    currentNum++;
  });

  // Guardar en historial
  const newInspectionBatch = {
    id: "ins-batch-" + Date.now(),
    timestamp: new Date().toISOString(),
    startOrder: String(startNumInput).padStart(5, '0') + `-${yearSuffix}`,
    endOrder: String(currentNum - 1).padStart(5, '0') + `-${yearSuffix}`,
    vehicleRhes: vehicleRhes,
    sheets: inspectionSheetsData
  };

  state.inspections.unshift(newInspectionBatch);
  logAction(`Emitido lote de revisiones desde orden #${newInspectionBatch.startOrder} hasta #${newInspectionBatch.endOrder} para ${vehicleRhes.length} vehículos.`);
  saveStateToStorage();

  // Imprimir lote
  generatePrintSheetsAndPrint(newInspectionBatch);

  // Limpiar checkboxes e incrementar el número inicial para la siguiente tanda
  state.settings.revisionStartNumber = currentNum;
  saveStateToStorage();
  updateHeaderRevision();
  
  if (document.getElementById('inspection-start-number')) {
    document.getElementById('inspection-start-number').value = currentNum;
  }
  
  renderInspectionsView();
});

// Generar las plantillas HTML imprimibles y gatillar impresión de navegador
function generatePrintSheetsAndPrint(batch) {
  const printContainer = document.getElementById('print-container');
  printContainer.innerHTML = '';

  const issuedAt = batch.timestamp ? new Date(batch.timestamp) : new Date();
  const issuedLabel = formatDateDDMMYYYY(issuedAt);
  const validUntilLabel = formatDateDDMMYYYY(addYears(issuedAt, 1));

  batch.sheets.forEach((sheet, index) => {
    const v = sheet.vehicle;
    const dependencyUnit = v.dependencia || v.unidad || 'Unidad C4 de Artillería';
    const vehicleModel = [v.modelo, v.year].filter(Boolean).join(' ');
    const normalizedOperatividad = normalizeOperatividad(v.operatividad);
    const sheetDiv = document.createElement('div');
    sheetDiv.className = 'print-sheet circulation-sheet';

    sheetDiv.innerHTML = `
      <div class="circulation-frame">
        <section class="circulation-panel circulation-panel--front">
          <header class="circulation-header">
            <div class="circulation-brand">
              <img src="assets/escudo-ffaa-honduras.png" alt="Escudo Fuerzas Armadas de Honduras" class="circulation-logo">
              <div>
                <div class="circulation-kicker">Fuerzas Armadas de Honduras</div>
                <div class="circulation-agency">Unidad C4 de Artillería</div>
              </div>
            </div>
            <div class="circulation-title-block">
              <h1>HOJA DE REVISIÓN VEHICULAR</h1>
              <div class="circulation-order">No. ${escapeHtml(sheet.orderNumber)}</div>
            </div>
          </header>

          <div class="circulation-data-grid">
            <div class="circulation-field circulation-field--wide">
              <span>Dependencia/Unidad:</span>
              <strong>${escapeHtml(dependencyUnit)}</strong>
            </div>
            <div class="circulation-field">
              <span>Registro (Placa):</span>
              <strong>${escapeHtml(v.rhe)}</strong>
            </div>
            <div class="circulation-field">
              <span>Tipo de vehículo:</span>
              <strong>${escapeHtml(v.type)}</strong>
            </div>
            <div class="circulation-field">
              <span>Marca:</span>
              <strong>${escapeHtml(v.marca)}</strong>
            </div>
            <div class="circulation-field">
              <span>Modelo:</span>
              <strong>${escapeHtml(vehicleModel)}</strong>
            </div>
            <div class="circulation-field">
              <span>Color:</span>
              <strong>${escapeHtml(v.color || 'N/A')}</strong>
            </div>
            <div class="circulation-field">
              <span>Número de motor:</span>
              <strong>${escapeHtml(v.motor)}</strong>
            </div>
            <div class="circulation-field">
              <span>Número de chasis:</span>
              <strong>${escapeHtml(v.chasis)}</strong>
            </div>
            <div class="circulation-field">
              <span>Operatividad:</span>
              <strong>${escapeHtml(normalizedOperatividad)}</strong>
            </div>
            <div class="circulation-field">
              <span>Emitido el:</span>
              <strong>${escapeHtml(issuedLabel)}</strong>
            </div>
            <div class="circulation-field">
              <span>Vigencia:</span>
              <strong>${escapeHtml(validUntilLabel)}</strong>
            </div>
          </div>

          <div class="circulation-signatures">
            <div class="circulation-signature-line">Jefe / Encargado de Flota</div>
            <div class="circulation-signature-line">Inspector Responsable</div>
          </div>
        </section>

        <section class="circulation-panel circulation-panel--back">
          <header class="circulation-header circulation-header--compact">
            <div>
              <div class="circulation-kicker">CÓDIGO ÚNICO IDENTIFICADOR</div>
              <div class="circulation-order">${escapeHtml(sheet.orderNumber)}</div>
              <div class="circulation-validity">Válida hasta: ${escapeHtml(validUntilLabel)}</div>
            </div>
            <img src="assets/escudo-ffaa-honduras.png" alt="Escudo Fuerzas Armadas de Honduras" class="circulation-logo circulation-logo--small">
          </header>

          <div class="circulation-qr-layout">
            <canvas id="qr-print-${batch.id}-${index}" class="print-qr-code circulation-qr"></canvas>
            <div class="circulation-qr-meta">
              <div><span>Usuario:</span><strong>${escapeHtml(state.settings.username || 'Administrador')}</strong></div>
              <div><span>Fecha:</span><strong>${escapeHtml(issuedLabel)}</strong></div>
              <div><span>Registro:</span><strong>${escapeHtml(v.rhe)}</strong></div>
              <div><span>Motor:</span><strong>${escapeHtml(v.motor)}</strong></div>
            </div>
          </div>

          <p class="circulation-legal">
            Documento interno de revisión vehicular generado para control de estado, identificación y alistamiento operativo de unidades de transporte.
          </p>
          <div class="circulation-footer-note">
            Podrá verificarse la autenticidad de este distintivo mediante el Código QR consignado en esta hoja.
          </div>
        </section>
      </div>
    `;

    printContainer.appendChild(sheetDiv);

    const qrDataText = `HOJA DE REVISIÓN VEHICULAR - FFAA HONDURAS
------------------------------
Orden de Revisión: ${sheet.orderNumber}
Dependencia/Unidad: ${dependencyUnit}
Registro (Placa): ${v.rhe}
Tipo de vehículo: ${v.type}
Marca: ${v.marca}
Modelo: ${vehicleModel}
Color: ${v.color || 'N/A'}
Número de motor: ${v.motor}
Número de chasis: ${v.chasis}
Operatividad: ${normalizedOperatividad}
Emitido el: ${issuedLabel}
Vigencia: ${validUntilLabel}`;

    setTimeout(() => {
      const qrPrintCanvas = document.getElementById(`qr-print-${batch.id}-${index}`);
      if (!window.QRious || !qrPrintCanvas) {
        console.warn('QRious no está disponible; se omite un QR de impresión.');
        return;
      }

      new QRious({
        element: qrPrintCanvas,
        value: qrDataText,
        size: 150,
        level: 'M'
      });
    }, 50);
  });

  setTimeout(() => {
    window.print();
  }, 350);
}

// Reimpresión de un lote completo ya generado
function reprintInspectionBatch(batchId) {
  const batch = state.inspections.find(ins => ins.id === batchId);
  if (batch) {
    // Buscar los objetos vehículo completos actualizados por si cambiaron de km o seguro
    const updatedSheets = batch.sheets.map(sheet => {
      const liveVehicle = state.vehicles.find(v => v.id === sheet.vehicle.id);
      return {
        orderNumber: sheet.orderNumber,
        vehicle: liveVehicle || sheet.vehicle
      };
    });

    const tempBatch = { ...batch, sheets: updatedSheets };
    generatePrintSheetsAndPrint(tempBatch);
  }
}

// ==========================================================================
// 7. REGISTRO DE MANTENIMIENTO
// ==========================================================================

const maintenanceVehicleSelect = document.getElementById('m-vehicle');
const maintenanceTableBody = document.getElementById('maintenance-table-body');
const maintenanceForm = document.getElementById('form-maintenance');

// Abrir modal de Registro de Mantenimiento
document.getElementById('btn-add-maintenance').addEventListener('click', () => openMaintenanceModal());
document.getElementById('quick-new-maintenance').addEventListener('click', () => openMaintenanceModal());

function openMaintenanceModal(vehicleId = null) {
  maintenanceForm.reset();
  document.getElementById('modal-maintenance-alert').classList.add('d-none');
  updateSelectors();

  if (vehicleId) {
    maintenanceVehicleSelect.value = vehicleId;
    // Autocompletar kilometraje actual si está disponible
    const v = state.vehicles.find(item => item.id === vehicleId);
    if (v) {
      document.getElementById('m-km').value = v.km;
    }
  }

  openModal('modal-maintenance');
}

// Actualizar listas desplegables de vehículos (para filtros y asignaciones)
function updateSelectors() {
  maintenanceVehicleSelect.innerHTML = '<option value="">Seleccione vehículo...</option>';
  
  // Ordenar vehículos alfabéticamente por RHE
  const sortedVehicles = [...state.vehicles].sort((a, b) => a.rhe.localeCompare(b.rhe));

  sortedVehicles.forEach(v => {
    // Los vehículos Chatarra no suelen recibir mantenimientos de aceite ordinarios, pero los listamos
    const chatarraIndicator = normalizeOperatividad(v.operatividad) === 'Chatarra' ? ' (CHATARRA)' : '';
    const option = document.createElement('option');
    option.value = v.id;
    option.textContent = `${v.rhe} - ${v.marca} ${v.modelo}${chatarraIndicator}`;
    maintenanceVehicleSelect.appendChild(option);
  });
}

// Rellenar kilometraje sugerido al seleccionar vehículo en mantenimiento
maintenanceVehicleSelect.addEventListener('change', (e) => {
  const vehicleId = e.target.value;
  if (vehicleId) {
    const v = state.vehicles.find(item => item.id === vehicleId);
    if (v) {
      document.getElementById('m-km').value = v.km;
    }
  }
});

// Guardar Mantenimiento
maintenanceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const vehicleId = maintenanceVehicleSelect.value;
  const kmInput = parseInt(document.getElementById('m-km').value);
  const oilMotor = document.getElementById('m-oil-motor').checked;
  const oilGear = document.getElementById('m-oil-gear').checked;
  const oil4x4 = document.getElementById('m-oil-4x4').checked;
  const oilDiff = document.getElementById('m-oil-diff').checked;
  const otherWork = document.getElementById('m-other').value.trim();

  // Validaciones
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) {
    alert("Vehículo no válido.");
    return;
  }

  if (kmInput < vehicle.km) {
    if (!confirm(`¡Advertencia! El kilometraje ingresado (${kmInput.toLocaleString()} km) es MENOR al kilometraje registrado actualmente para esta unidad (${vehicle.km.toLocaleString()} km). ¿Estás seguro de continuar?`)) {
      return;
    }
  }

  // Registrar mantenimiento
  const newMaintenance = {
    id: "m-" + Date.now(),
    vehicleId: vehicleId,
    vehicleRhe: vehicle.rhe,
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    km: kmInput,
    oilMotor: oilMotor,
    oilGear: oilGear,
    oil4x4: oil4x4,
    oilDiff: oilDiff,
    other: otherWork
  };

  state.maintenances.unshift(newMaintenance);

  // Actualizar kilometraje y estado del vehículo si procede
  const vehicleIndex = state.vehicles.findIndex(v => v.id === vehicleId);
  if (vehicleIndex !== -1) {
    state.vehicles[vehicleIndex].km = kmInput;
    
    // Si era recuperable y se le hace mantenimiento integral, sugerir o registrar
    if (normalizeOperatividad(state.vehicles[vehicleIndex].operatividad) === 'Recuperable' && (oilMotor || otherWork)) {
      logAction(`Kilometraje de ${vehicle.rhe} actualizado a ${kmInput.toLocaleString()} km.`);
    }
  }

  // Generar descripción para auditoría
  let detailDesc = [];
  if (oilMotor) detailDesc.push("Aceite Motor");
  if (oilGear) detailDesc.push("Aceite Caja");
  if (oil4x4) detailDesc.push("Aceite Transmisión 4x4");
  if (oilDiff) detailDesc.push("Aceite Diferencial");
  if (otherWork) detailDesc.push("Reparaciones Adicionales");

  const auditMessage = `Mantenimiento registrado para ${vehicle.type} [${vehicle.rhe}] en km ${kmInput.toLocaleString()}. Trabajos realizados: ${detailDesc.join(', ')}.`;
  
  logAction(auditMessage);
  saveStateToStorage();
  closeModal('modal-maintenance');

  // Refrescar vistas
  renderMaintenanceView();
  initDashboard();
  renderFleetTable();
});

function renderMaintenanceView() {
  maintenanceTableBody.innerHTML = '';

  if (state.maintenances.length === 0) {
    maintenanceTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center text-muted py-4">No hay reportes de mantenimiento registrados.</td>
      </tr>
    `;
    return;
  }

  state.maintenances.forEach(m => {
    const tr = document.createElement('tr');
    tr.className = 'maintenance-row';
    tr.style.cursor = 'pointer';
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `Ver detalle de mantenimiento ${m.vehicleRhe} ${formatMaintenanceDate(m.date)}`);
    
    // Convertir booleano a Check icon o Cruz
    const checkHTML = (val) => val ? `<i data-lucide="check" class="text-green" style="width:16px; height:16px;"></i> Sí` : `<span class="text-muted">—</span>`;

    // Formatear fecha
    const dateFormatted = m.date.split('-').reverse().join('/'); // DD/MM/YYYY

    tr.innerHTML = `
      <td class="text-bold">${escapeHtml(dateFormatted)}</td>
      <td class="text-bold text-mono">${escapeHtml(m.vehicleRhe)}</td>
      <td>${escapeHtml(m.km.toLocaleString())} km</td>
      <td>${checkHTML(m.oilMotor)}</td>
      <td>${checkHTML(m.oilGear)}</td>
      <td>${checkHTML(m.oil4x4)}</td>
      <td>${checkHTML(m.oilDiff)}</td>
      <td class="text-small" style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(m.other || 'Ninguno')}">
        ${m.other ? escapeHtml(m.other) : '<span class="text-muted">Ninguno</span>'}
      </td>
      <td class="text-right" onclick="event.stopPropagation();">
        <button class="btn btn-sm btn-danger" onclick="deleteMaintenance(${safeInlineJsArg(m.id)})" title="Eliminar Reporte">
          <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
        </button>
      </td>
    `;
    tr.addEventListener('click', () => showMaintenanceDetail(m.id));
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showMaintenanceDetail(m.id);
      }
    });
    maintenanceTableBody.appendChild(tr);
  });
  refreshIcons();
}

function showMaintenanceDetail(maintId) {
  const m = state.maintenances.find(item => item.id === maintId);
  if (!m) return;

  const vehicle = state.vehicles.find(v => v.id === m.vehicleId);
  const checkHTML = (val) => val ? '<span class="Label Label--success">Sí</span>' : '<span class="Label">No</span>';
  const content = document.getElementById('maintenance-detail-content');

  content.innerHTML = `
    <ul class="spec-list mb-3">
      <li class="spec-item"><span class="spec-label">Unidad</span><span class="spec-val text-mono text-bold">${escapeHtml(m.vehicleRhe)}</span></li>
      <li class="spec-item"><span class="spec-label">Vehículo</span><span class="spec-val">${escapeHtml(vehicle ? `${vehicle.marca} ${vehicle.modelo}` : 'No encontrado')}</span></li>
      <li class="spec-item"><span class="spec-label">Fecha</span><span class="spec-val">${escapeHtml(formatMaintenanceDate(m.date))}</span></li>
      <li class="spec-item"><span class="spec-label">Kilometraje</span><span class="spec-val">${escapeHtml(Number(m.km || 0).toLocaleString())} km</span></li>
      <li class="spec-item"><span class="spec-label">Aceite motor</span><span class="spec-val">${checkHTML(m.oilMotor)}</span></li>
      <li class="spec-item"><span class="spec-label">Aceite caja</span><span class="spec-val">${checkHTML(m.oilGear)}</span></li>
      <li class="spec-item"><span class="spec-label">Aceite transmisión 4x4</span><span class="spec-val">${checkHTML(m.oil4x4)}</span></li>
      <li class="spec-item"><span class="spec-label">Aceite diferencial</span><span class="spec-val">${checkHTML(m.oilDiff)}</span></li>
    </ul>
    <h4 class="card-section-title">Otros trabajos / observaciones</h4>
    <div class="Box p-3 bg-subtle text-small">${escapeHtml(m.other || 'Sin otros trabajos registrados.')}</div>
  `;

  openModal('modal-maintenance-detail');
  refreshIcons();
}

function deleteMaintenance(maintId) {
  const m = state.maintenances.find(item => item.id === maintId);
  if (m) {
    if (confirm(`¿Estás seguro de que querés borrar este reporte de mantenimiento para ${m.vehicleRhe} del día ${m.date}?`)) {
      state.maintenances = state.maintenances.filter(item => item.id !== maintId);
      logAction(`Reporte de mantenimiento para placa [${m.vehicleRhe}] eliminado del historial.`);
      saveStateToStorage();
      
      renderMaintenanceView();
      initDashboard();
    }
  }
}

// ==========================================================================
// 8. GENERAL MODAL UTILITIES (APERTURA Y CIERRE)
// ==========================================================================

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// Escuchar cierres de modales con botones de clase data-close-modal
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const modalId = btn.getAttribute('data-close-modal');
    closeModal(modalId);
  });
});

// Registrar eventos de acciones rápidas o enlaces directos
document.getElementById('quick-new-revision').addEventListener('click', () => {
  navigateToTab('tab-inspections');
});
document.getElementById('btn-load-demo').addEventListener('click', loadDemoData);
document.getElementById('btn-clear-logs').addEventListener('click', clearAuditLogs);

// ==========================================================================
// 9. INICIALIZACIÓN GLOBAL DE LA APLICACIÓN
// ==========================================================================

// ==========================================================================
// 9. CONFIGURACIONES, PERFIL Y DEPURACIÓN
// ==========================================================================

// Menú desplegable de usuario
const btnProfile = document.getElementById('user-profile-btn');
const dropdownMenu = document.getElementById('user-dropdown-menu');

if (btnProfile && dropdownMenu) {
  btnProfile.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('active');
  });
  
  // Cerrar al clickear afuera
  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('active');
  });
  
  // Eventos de opciones
  document.getElementById('btn-view-profile').addEventListener('click', () => {
    alert('Funcionalidad de "Ver perfil" en desarrollo.');
  });
  
  document.getElementById('btn-logout').addEventListener('click', () => {
    apiRequest('/api/logout', { method: 'POST', body: '{}' })
      .catch(() => {})
      .finally(() => {
        authState = { user: null, sessionId: null };
        showAuthGate();
      });
  });
  
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    openSettingsModal();
  });
}

function openSettingsModal() {
  document.getElementById('settings-theme-toggle').checked = state.settings.theme === 'dark';
  document.getElementById('settings-currency').value = state.settings.currency;
  document.getElementById('settings-rev-start').value = state.settings.revisionStartNumber;
  document.getElementById('settings-rev-suffix').value = state.settings.revisionYearSuffix;
  document.getElementById('settings-purge-confirm').value = '';
  document.getElementById('btn-purge-data').disabled = true;
  openModal('modal-settings');
}

// Configuración de Theme, Moneda y Revisiones
document.getElementById('settings-theme-toggle').addEventListener('change', (e) => {
  state.settings.theme = e.target.checked ? 'dark' : 'light';
  saveStateToStorage();
  applyTheme();
  initDashboard();
});

document.getElementById('settings-currency').addEventListener('change', (e) => {
  state.settings.currency = e.target.value;
  saveStateToStorage();
  updateCurrencyLabels();
  const openEditId = document.getElementById('vehicle-id-edit').value;
  if (document.getElementById('modal-card').classList.contains('active') && !openEditId) {
    closeModal('modal-card');
  }
});

document.getElementById('settings-rev-start').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  if (!isNaN(val) && val > 0) {
    state.settings.revisionStartNumber = val;
    saveStateToStorage();
    updateHeaderRevision();
  }
});

document.getElementById('settings-rev-suffix').addEventListener('input', (e) => {
  state.settings.revisionYearSuffix = e.target.value;
  saveStateToStorage();
  updateHeaderRevision();
});

function updateUserProfileName() {
  const profileName = document.getElementById('user-profile-name');
  if (profileName) profileName.textContent = state.settings.username || 'Administrador';
}

function updateHeaderRevision() {
  const label = document.getElementById('header-last-revision');
  if (label) {
    label.style.display = 'inline-block';
    const formatted = String(state.settings.revisionStartNumber).padStart(5, '0') + '-' + state.settings.revisionYearSuffix;
    label.textContent = 'Última revisión: ' + formatted;
  }
}

function updateCurrencyLabels() {
  const lbls = document.querySelectorAll('.currency-lbl');
  const symbol = state.settings.currency === 'HNL' ? '(L. Lempiras)' : '($ USD)';
  lbls.forEach(l => l.textContent = symbol);
}

// Lógica de Depuración
const inputPurge = document.getElementById('settings-purge-confirm');
const btnPurge = document.getElementById('btn-purge-data');

inputPurge.addEventListener('input', (e) => {
  btnPurge.disabled = e.target.value !== 'eliminar-datos';
});

btnPurge.addEventListener('click', () => {
  if (confirm('¿Estás SEGURO de que deseas depurar TODA la base de datos? Esta acción es irreversible.')) {
    state.vehicles = [];
    state.maintenances = [];
    state.inspections = [];
    
    // Registrar el borrado en el audit log (no se borra el historial previo, se agrega el evento crítico)
    logAction('ALERTA CRÍTICA: El administrador depuró la base de datos. Todos los vehículos y mantenimientos fueron eliminados.');
    
    saveStateToStorage();
    
    closeModal('modal-settings');
    renderFleetTable();
    initDashboard();
    updateSelectors();
    updateCounters();
    alert('Depuración completada exitosamente.');
  }
});

// ==========================================================================
// 10. INICIALIZACIÓN GLOBAL DE LA APLICACIÓN
// ==========================================================================

async function initializeApplication() {
  const hasSession = await loadCurrentSession();
  if (!hasSession) {
    refreshIcons();
    return;
  }

  // Cargar estado desde almacenamiento local
  loadState();
  applyAuthUi();
  
  // Actualizar etiquetas de moneda en la UI
  updateCurrencyLabels();
  
  // Actualizar header
  updateHeaderRevision();
  updateUserProfileName();

  // Iniciar la pestaña inicial (Tablero)
  initDashboard();

  // Registrar íconos Lucide
  refreshIcons();
}

window.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('form-login');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = document.getElementById('login-error');
      const button = document.getElementById('btn-login');
      if (error) error.classList.add('d-none');
      if (button) button.disabled = true;

      try {
        const session = await apiRequest('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            username: document.getElementById('login-username').value,
            password: document.getElementById('login-password').value
          })
        });
        authState.user = session.user;
        authState.sessionId = session.sessionId;
        hideAuthGate();
        applyAuthUi();
        initializeApplication();
      } catch (loginError) {
        showAuthGate(loginError.message);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  initializeApplication();
});

// ==========================================================================
// 11. IMPORTACIÓN DE CSV
// ==========================================================================

const fileImportCsv = document.getElementById('file-import-csv');
if (fileImportCsv) {
  fileImportCsv.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      importVehiclesFromCSV(content);
      // Reset input
      fileImportCsv.value = '';
    };
    reader.readAsText(file);
  });
}

function importVehiclesFromCSV(csvText) {
  const lines = csvText.split('\n');
  let importedCount = 0;
  let skippedCount = 0;

  // Empezar desde 1 para ignorar encabezados
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parseo básico de CSV manejando posibles comillas en los valores
    const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());

    if (cols.length < 22) continue; // Línea incompleta

    const rhe = cols[10].toUpperCase();
    
    const existingIndex = state.vehicles.findIndex(v => v.rhe === rhe);
    if (existingIndex !== -1) {
        skippedCount++;
        continue;
    }

    const vehicleData = {
      id: "v-" + Date.now() + "-" + Math.floor(Math.random() * 1000) + i,
      type: cols[5] || "Camión",
      marca: cols[6] || "OTRA",
      modelo: cols[7] || "",
      color: cols[8] || "",
      year: parseInt(cols[9]) || new Date().getFullYear(),
      rhe: rhe,
      chasis: cols[11].toUpperCase(),
      motor: cols[12].toUpperCase(),
      operatividad: normalizeOperatividad(cols[13] || "Operativo"),
      situacion: cols[14] || "",
      traction: cols[15] || "Sencillo",
      transmission: cols[16] || "Mecánica",
      cabin: cols[17] || "Sencilla",
      cabinOther: "",
      fuel: cols[18] || "Diesel",
      tyreNum: parseInt(cols[19]) || 4,
      acquisition: cols[20] || "Fondo nacional",
      acquisitionOther: "",
      categoria: cols[21] || "Administrativo",

      km: 0,
      engineSize: 0,
      cylinders: 4,
      hp: 0,
      oilMotor: "",
      oilGear: "",
      oil4x4: "",
      oilDiff: "",
      filterAir: "",
      filterFuel: "",
      tanks: 1,
      tankCap: 0,
      autoHwy: 0,
      autoMix: 0,
      rin: "",
      speeds: 5,
      load: 0,
      passengersEq: 0,
      passengersNoEq: 0,
      value: 0,
      hasInsurance: false,
      insuranceCo: "",
      insuranceNum: "",
      insuranceValue: 0,
      observations: "Importado desde CSV."
    };

    state.vehicles.push(vehicleData);
    importedCount++;
  }

  if (importedCount > 0) {
    saveStateToStorage();
    logAction(`Se importaron ${importedCount} unidades desde archivo CSV.`);
    renderFleetTable();
    initDashboard();
    updateSelectors();
    updateCounters();
    alert(`Importación completada: ${importedCount} vehículos agregados al inventario.`);
  } else if (skippedCount > 0) {
    alert(`No se importó ningún vehículo. Se omitieron ${skippedCount} registros que ya existían (duplicados).`);
  } else {
    alert(`El archivo CSV está vacío o no tiene el formato de 22 columnas requerido.`);
  }
}
