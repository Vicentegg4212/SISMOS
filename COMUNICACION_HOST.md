# 🖥️ Guía de Comunicación Bot ↔ Windows Host

## ✅ Estado Actual
El bot está completamente configurado para comunicarse con Windows.

---

## 🚀 Cómo Ejecutar el Bot

### 1. **Abrir Terminal en la carpeta del bot**
```powershell
cd c:\Users\Administrador\Desktop\sexoooo
```

### 2. **Iniciar el Bot**
```powershell
node index.js
```

### 3. **Indicador de Éxito**
Deberías ver en la consola:
```
✅ Bot iniciado exitosamente
🔄 Iniciando ciclo de verificación...
💬 Bot escuchando en chat: [tu_chat_id]
```

---

## 📡 Canales de Comunicación Disponibles

### **1. Comunicación Básica**
```
/ping              → Verificar que bot responde
/start             → Menú principal
/help              → Lista de comandos
```

### **2. Ejecución de Comandos Windows**
```
/system_command <comando>
Ejemplo:
  /system_command tasklist
  /system_command netstat -ano
  /system_command dir C:\Users
```

### **3. Integración Visual Studio Code**
```
/vscode_status            → Ver si VS Code está instalado y activo
/vscode_open <archivo>    → Abrir archivo en VS Code
/vscode_command <cmd>     → Ejecutar comando VS Code
```

### **4. Ejecución Node.js**
```
/node_exec <código>
Ejemplo:
  /node_exec console.log("Hola desde Node")
  /node_exec require('os').platform()
```

### **5. Comunicación con Procesos**
```
/process_communicate <proceso>      → Info de procesos
/force_communication <objetivo>      → Comunicación forzada
/running_apps                        → Procesos activos
```

### **6. Información del Sistema**
```
/system_info        → Información del SO
/memory_info        → Uso de memoria
/cpu_info          → Información de CPU
/network_info      → Información de red
/disk_info         → Información de disco
/battery           → Estado de batería
```

### **7. Centro de Control**
```
/communication_hub   → Panel de comunicaciones
/interprocess_comms  → Sistema de IPC
```

---

## 🔐 Permisos de Administrador

Para usar comandos avanzados necesitas ser admin:

### **Convertirse en Admin:**
1. Envía al bot: `/become_admin`
2. El bot te mostrará tu Chat ID
3. Guárdalo o establécelo como variable de entorno

### **Verificar Admin:**
```
/whoami             → Ver tu ID de chat
/admin_status       → Ver estado de permisos
```

---

## 💾 Ejemplo: Flujo de Comunicación

```
👤 Usuario envía:    /system_command whoami
↓
🤖 Bot recibe comando
↓
⚙️ Bot ejecuta en Windows PowerShell
↓
🖥️ Windows devuelve resultado
↓
📱 Bot envía resultado al usuario
```

---

## 🛡️ Comandos de Administración

### **Monitoreo**
```
/diagnose           → Diagnóstico completo del sistema
/performance        → Métricas de rendimiento
/check_connection   → Verificar conectividad
/system_status      → Estado del bot
```

### **Mantenimiento**
```
/restart            → Reiniciar bot
/clear_logs         → Limpiar logs
/reset_browser      → Reiniciar Puppeteer
/maintenance on/off → Modo mantenimiento
```

### **Backups**
```
/backup             → Crear backup
/list_backups       → Ver backups
/send_backup        → Descargar backup
/restore_backup [#] → Restaurar backup
```

---

## 📊 Panel de Control Sistema

```
/system             → Abrir panel de control
  → 📊 Monitoreo del Sistema
  → 💾 Recursos y Almacenamiento
  → 👥 Gestión de Usuarios
  → 🔧 Configuración y Ajustes
  → 🚨 Seguridad y Alertas
  → 📈 Estadísticas y Reportes
```

---

## 🔧 Configuración

### **Variables de Entorno**
```powershell
$env:TELEGRAM_TOKEN = "tu_token"
$env:ADMIN_CHAT_ID = "tu_id"
```

### **Archivo de Config**
Ver `index.js` líneas 37-80 para modificar:
- `checkInterval`: Tiempo entre verificaciones
- `heartbeatInterval`: Latido de corazón del bot
- `enableHostIntegration`: Habilitar comunicación Windows
- `allowSystemCommands`: Permitir comandos del sistema

---

## 🐛 Solución de Problemas

### ❌ "Bot no responde"
1. Verifica que el bot esté ejecutándose
2. Confirma tu Chat ID: `/whoami`
3. Revisa los logs: `/send_logs`

### ❌ "Comando del sistema falla"
1. Verifica que tengas permisos admin
2. Revisa el comando de Windows manualmente
3. Usa `/diagnose` para más información

### ❌ "VS Code no funciona"
1. Instala VS Code si no lo tienes
2. Verifica PATH: `code --version`
3. Usa `/vscode_status` para verificar

---

## 📈 Estadísticas en Tiempo Real

```
/bot_stats         → Estadísticas completas del bot
/memory            → Uso de memoria actual
/performance       → Rendimiento del sistema
/file_info         → Información de archivos
```

---

## ✨ Ejemplo de Sesión Completa

```powershell
# 1. Iniciar bot
node index.js

# 2. En Telegram, convertirse en admin
/become_admin

# 3. Verificar estado
/system_status

# 4. Ver procesos activos
/running_apps

# 5. Ejecutar comando Windows
/system_command Get-Process | Select-Object Name, CPU, Memory | Format-Table

# 6. Abrir archivo en VS Code
/vscode_open index.js

# 7. Ejecutar código Node.js
/node_exec console.log('Comunicación exitosa')

# 8. Ver panel de control
/system

# 9. Crear backup
/backup

# 10. Ver estadísticas
/bot_stats
```

---

## 🎯 Próximos Pasos

✅ Ejecuta el bot: `node index.js`
✅ Conviértete en admin: `/become_admin`
✅ Prueba comunicación: `/system_info`
✅ Explora funciones: `/system`
✅ Crea backups: `/backup`

---

**Bot SASMEX v2.0 - Comunicación Windows Completa Activada** ✅
