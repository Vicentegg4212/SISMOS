# 🤖 SASMEX Telegram Bot

Bot de Telegram avanzado para monitoreo del sistema SASMEX con integración completa del sistema host.

## 🚀 Características

### 📊 Monitoreo del Sistema
- Monitoreo continuo de alertas SASMEX
- Capturas de pantalla automáticas
- Sistema de recuperación automática
- Alertas proactivas al administrador

### 🖥️ Integración con Sistema Host
- Comunicación con procesos del sistema
- Ejecución de comandos del sistema
- Integración completa con VS Code
- Monitoreo de recursos del sistema

### 🔧 Comandos Avanzados
- `/system_command` - Ejecutar comandos del sistema
- `/node_exec` - Ejecutar código Node.js
- `/vscode_status` - Estado de VS Code
- `/process_communicate` - Comunicación con procesos
- `/force_communication` - Comunicación forzada
- `/communication_hub` - Centro de control de comunicaciones

### 📈 Sistema de Monitoreo
- Información de CPU, memoria, disco
- Estado de red y conectividad
- Información de batería y USB
- Servicios del sistema
- Aplicaciones en ejecución

## 🛠️ Instalación

1. Clona el repositorio:
```bash
git clone https://github.com/Vicentegg4212/SISMOS.git
cd SISMOS
```

2. Instala dependencias:
```bash
npm install
```

3. Configura las variables de entorno (opcional):
```bash
export TELEGRAM_TOKEN="tu_token_aqui"
export ADMIN_CHAT_ID="tu_chat_id_aqui"
```

4. Ejecuta el bot:
```bash
node index.js
```

## 📋 Requisitos

- Node.js 16+
- Puppeteer
- Telegram Bot Token
- Windows (para integración completa del sistema)

## 🔐 Seguridad

- Sistema de permisos basado en chat ID
- Validación de comandos
- Logs detallados de todas las operaciones
- Modo mantenimiento

## 📞 Uso

1. En Telegram, busca el bot con el token configurado
2. Usa `/start` para comenzar
3. Usa `/become_admin` para obtener permisos de administrador
4. Explora los comandos disponibles con `/help`

## 🤝 Contribución

Siéntete libre de contribuir con mejoras, correcciones de bugs o nuevas características.

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.