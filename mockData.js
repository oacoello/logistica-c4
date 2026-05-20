/**
 * FLOTAHUB - SEED DATA (DATOS SEMILLA REALISTAS SIN PLACEHOLDERS)
 * 
 * Estos datos contienen fichas técnicas reales y detalladas para propósitos de prueba inmediata.
 * Todos los campos coinciden exactamente con la especificación técnica requerida por el usuario.
 */

const SEED_VEHICLES = [
  {
    id: "v-hilux-00170",
    rhe: "RHE-00170",
    type: "Pickup",
    marca: "TOYOTA",
    modelo: "Hilux Revo 2.8 D-4D",
    chasis: "AHTFR22G90209481",
    motor: "1GD-FTV-8392019",
    year: 2022,
    operatividad: "Operativo",
    situacion: "Asignado a patrullaje y enlace de comunicaciones",
    categoria: "Táctico",
    
    // Especificaciones técnicas
    km: 38450,
    engineSize: 2800,
    cylinders: 4,
    hp: 201,
    traction: "Doble",
    transmission: "Mecánica",
    cabin: "Doble cabina",
    cabinOther: "",
    fuel: "Diesel",
    oilMotor: "15W-40 ACEA E9",
    oilGear: "75W-90 GL-4",
    oil4x4: "75W-90 GL-5",
    oilDiff: "80W-90 LSD",
    filterAir: "17801-0L040",
    filterFuel: "23390-0L070",
    tanks: 1,
    tankCap: 21,
    autoHwy: 44.5,
    autoMix: 38.2,
    tyreNum: 4,
    rin: "17",
    speeds: 6,
    load: 2205,
    passengersEq: 3,
    passengersNoEq: 5,
    
    // Adquisición y seguro
    acquisition: "Fondo nacional",
    acquisitionOther: "",
    value: 38500,
    hasInsurance: true,
    insuranceCo: "Seguros del País S.A.",
    insuranceNum: "POL-HILUX-2022-9029",
    insuranceValue: 35000,
    
    observations: "Mantenimientos al día. Excelente consumo de combustible. Operando en condiciones óptimas."
  },
  {
    id: "v-unimog-00185",
    rhe: "RHE-00185",
    type: "Camión",
    marca: "AM GENERAL",
    modelo: "UNIMOG U4000 4x4",
    chasis: "WDB4371011W209481",
    motor: "OM904LA-462819",
    year: 2018,
    operatividad: "Recuperable",
    situacion: "Esperando repuestos de tren delantero en taller central",
    categoria: "Combate",
    
    // Especificaciones técnicas
    km: 84120,
    engineSize: 4250,
    cylinders: 4,
    hp: 177,
    traction: "Doble",
    transmission: "Mecánica",
    cabin: "Sencilla",
    cabinOther: "",
    fuel: "Diesel",
    oilMotor: "15W-40 API CI-4",
    oilGear: "80W-90 GL-4",
    oil4x4: "80W-90 GL-4",
    oilDiff: "85W-90 GL-5",
    filterAir: "A0040943504",
    filterFuel: "A0004771302",
    tanks: 2,
    tankCap: 38,
    autoHwy: 18.5,
    autoMix: 14.2,
    tyreNum: 4,
    rin: "20",
    speeds: 8,
    load: 9920,
    passengersEq: 2,
    passengersNoEq: 3,
    
    // Adquisición y seguro
    acquisition: "Convenio FMS",
    acquisitionOther: "Programa FMS Militar 2018",
    value: 125000,
    hasInsurance: true,
    insuranceCo: "Aseguradora Nacional de Bienes",
    insuranceNum: "POL-FMS-MOG-0938",
    insuranceValue: 110000,
    
    observations: "Vehículo requiere cambio preventivo de filtro de combustible y revisión de rodamientos de transmisión."
  },
  {
    id: "v-jeep-00210",
    rhe: "RHE-00210",
    type: "Jeep",
    marca: "TOYOTA",
    modelo: "Land Cruiser FJ40",
    chasis: "FJ40-3029104",
    motor: "2F-8930219",
    year: 1982,
    operatividad: "Chatarra",
    situacion: "Fuera de servicio para recuperación de partes",
    categoria: "Administrativo",
    
    // Especificaciones técnicas
    km: 412500,
    engineSize: 4200,
    cylinders: 6,
    hp: 135,
    traction: "Doble",
    transmission: "Mecánica",
    cabin: "Sencilla",
    cabinOther: "",
    fuel: "Gasolina",
    oilMotor: "20W-50 API SL",
    oilGear: "90W GL-4",
    oil4x4: "90W GL-4",
    oilDiff: "90W GL-5",
    filterAir: "17801-68010",
    filterFuel: "23300-60020",
    tanks: 1,
    tankCap: 16,
    autoHwy: 22.0,
    autoMix: 18.5,
    tyreNum: 4,
    rin: "15",
    speeds: 4,
    load: 1500,
    passengersEq: 4,
    passengersNoEq: 6,
    
    // Adquisición y seguro
    acquisition: "Donación",
    acquisitionOther: "",
    value: 6500,
    hasInsurance: false,
    insuranceCo: "",
    insuranceNum: "",
    insuranceValue: 0,
    
    observations: "Vehículo se encuentra en el CALFA en calidad de depósito."
  }
];

const SEED_MAINTENANCES = [
  {
    id: "m-1",
    vehicleId: "v-hilux-00170",
    vehicleRhe: "RHE-00170",
    date: "2026-04-10",
    km: 35100,
    oilMotor: true,
    oilGear: false,
    oil4x4: false,
    oilDiff: true,
    other: "Cambio preventivo de filtro de aire (Código: 17801-0L040). Engrase general de articulaciones de dirección."
  },
  {
    id: "m-2",
    vehicleId: "v-unimog-00185",
    vehicleRhe: "RHE-00185",
    date: "2026-03-05",
    km: 83900,
    oilMotor: true,
    oilGear: true,
    oil4x4: true,
    oilDiff: true,
    other: "Mantenimiento general programado de caja y transmisión 4x4. Limpieza profunda del código de filtro de aire A0040943504."
  }
];

const SEED_AUDIT_LOG = [
  {
    id: "log-1",
    timestamp: "2026-05-19T10:15:30Z",
    action: "Inicialización del sistema con base de datos semilla verificada."
  },
  {
    id: "log-2",
    timestamp: "2026-05-19T11:22:15Z",
    action: "Vehículo Toyota FJ40 [RHE-00210] ingresado al depósito CALFA."
  },
  {
    id: "log-3",
    timestamp: "2026-05-19T14:40:00Z",
    action: "Registro de mantenimiento de cambio de aceite completo para UNIMOG [RHE-00185]."
  }
];
