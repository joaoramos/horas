#!/bin/sh
# Copia os estilos do site do Jardim da Mata para public/jm/, sem alterações.
# Mantém a mesma estrutura de pastas, para que os caminhos relativos em themes.css funcionem.
# A app usa sempre o Tema 3 — Dinâmico (data-theme="tema-3" em public/index.html), por isso não copia
# o seletor de temas (theme-switcher.js) nem as imagens e o tipo de letra dos outros temas.
# Uso: npm run sincronizar-estilos [caminho do repositório jardimdamata]
set -e
ORIGEM="${1:-../jardimdamata}"
DESTINO="$(dirname "$0")/../public/jm"

rm -rf "$DESTINO"
mkdir -p "$DESTINO/design-system/logo" "$DESTINO/novo"
cp "$ORIGEM/design-system/tokens.css" "$DESTINO/design-system/"
cp "$ORIGEM/design-system/logo/jardim-da-mata-mark.png" \
   "$ORIGEM/design-system/logo/favicon-32.png" \
   "$ORIGEM/design-system/logo/apple-touch-icon.png" "$DESTINO/design-system/logo/"
cp "$ORIGEM/novo/site.css" "$ORIGEM/novo/themes.css" "$DESTINO/novo/"
echo "Estilos copiados de $ORIGEM para $DESTINO"
