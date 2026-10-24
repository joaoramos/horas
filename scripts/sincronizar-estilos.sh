#!/bin/sh
# Copia os estilos do site do Jardim da Mata para public/jm/, sem alterações.
# Mantém a mesma estrutura de pastas, para que os caminhos relativos em themes.css funcionem.
# Uso: npm run sincronizar-estilos [caminho do repositório jardimdamata]
set -e
ORIGEM="${1:-../jardimdamata}"
DESTINO="$(dirname "$0")/../public/jm"

rm -rf "$DESTINO"
mkdir -p "$DESTINO/design-system/logo" "$DESTINO/novo" "$DESTINO/assets"
cp "$ORIGEM/design-system/tokens.css" "$DESTINO/design-system/"
cp "$ORIGEM/design-system/logo/jardim-da-mata-mark.png" \
   "$ORIGEM/design-system/logo/favicon-32.png" \
   "$ORIGEM/design-system/logo/apple-touch-icon.png" "$DESTINO/design-system/logo/"
cp "$ORIGEM/novo/site.css" "$ORIGEM/novo/themes.css" "$ORIGEM/novo/theme-switcher.js" "$DESTINO/novo/"
rsync -a --exclude .DS_Store "$ORIGEM/novo/themes" "$DESTINO/novo/"
cp "$ORIGEM/assets/obloom.woff2" "$ORIGEM/assets/obloom.woff" "$DESTINO/assets/"
echo "Estilos copiados de $ORIGEM para $DESTINO"
