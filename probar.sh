#!/usr/bin/env bash
# probar.sh — Corre las pruebas automáticas de Verde en una carpeta temporal.
# No toca los datos reales, no usa las claves reales y no sale a internet.
# Uso (en el servidor):  cd /root/verde-dashboard && bash probar.sh
set -u
ORIGEN="$(cd "$(dirname "$0")" && pwd)"
PROD="${VERDE_PROD:-/root/verde-comportamiento}"
TMP="$(mktemp -d /tmp/verde-pruebas-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

for f in server.js bot.js configurar-360.js pruebas/pruebas-verde.js; do
  if [ ! -f "$ORIGEN/$f" ]; then echo "✘ FALLÓ: falta el archivo $f"; echo "Pruebas OK: 0 · con fallas: 1"; exit 1; fi
done
if [ ! -d "$PROD/node_modules" ]; then
  echo "✘ FALLÓ: no encuentro las librerías en $PROD/node_modules"; echo "Pruebas OK: 0 · con fallas: 1"; exit 1
fi

mkdir -p "$TMP/data" "$TMP/public"
cp "$ORIGEN/server.js" "$ORIGEN/bot.js" "$ORIGEN/configurar-360.js" "$ORIGEN/pruebas/pruebas-verde.js" "$TMP/"
ln -s "$PROD/node_modules" "$TMP/node_modules"
echo "<html>panel de prueba</html>" > "$TMP/public/index.html"
cat > "$TMP/.env" <<'FIN'
ANTHROPIC_API_KEY=clave-ia-de-prueba
PORT=39871
D360_API_KEY=clave-360-de-prueba
D360_MESSAGES_URL=https://waba-sandbox.360dialog.io/v1/messages
D360_WEBHOOK_SECRET=secreto123abc
FIN
cat > "$TMP/data/state.json" <<'FIN'
{ "verde": { "nombre": "Verde", "empresa": "Pantalla Verde", "encendido": true,
  "frases": { "error": "Error técnico, te paso con un asesor.", "adjunto": "Gracias, recibí tu archivo. Un asesor lo revisa." },
  "tecnico": { "modelo": "claude-sonnet-4-5", "maxTokens": 1000, "memoria": 6 },
  "reglas": ["No dar precios"] },
  "sources": [] }
FIN

echo "Probando Verde en una carpeta temporal (no toca nada real)..."
cd "$TMP" && env -u ANTHROPIC_API_KEY -u PORT -u HOST -u D360_API_KEY -u D360_MESSAGES_URL -u D360_WEBHOOK_SECRET \
  -u VERDE_ESFUERZO -u VERDE_PAUSA_HORAS -u ANTHROPIC_VERSION -u PUBLIC_URL -u D360_CONFIG_URL \
  node pruebas-verde.js
