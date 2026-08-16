#!/usr/bin/env bash
# Запуск приложения "Социальный рейтинг" (Mac/Linux).
# Открывает http://localhost:8000/ и заодно позволяет зайти с телефона по Wi-Fi.

set -e
cd "$(dirname "$0")"

PORT=8000
echo "Локальный сервер на порту $PORT"
echo "  На этом устройстве: http://localhost:$PORT/"
echo "  С телефона по Wi-Fi: http://<IP-этого-устройства>:$PORT/"
echo "  (IP можно узнать командой: ifconfig  или  ip a)"
echo "Остановить — Ctrl+C"
echo "---------------------------------------------------"

# открываем браузер, если есть чем
if command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" &
elif command -v open >/dev/null 2>&1;       then open "http://localhost:$PORT/" &
fi

python3 -m http.server $PORT --bind 0.0.0.0
