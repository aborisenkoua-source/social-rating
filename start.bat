@echo off
chcp 65001 >nul
REM Запуск приложения "Социальный рейтинг" на ПК и открытие его в браузере.
REM Телефон сможет зайти по адресу http://<IP-этого-ПК>:8000 через Wi-Fi.

setlocal
cd /d "%~dp0"

REM Проверяем доступность Python
where python >nul 2>nul
if errorlevel 1 (
  echo [!] Python не найден в PATH. Открываем файл напрямую в браузере.
  echo     (с телефона в этом случае зайти не получится)
  start "" "%CD%\index.html"
  exit /b 0
)

echo Запускаем локальный сервер на порту 8000...
echo.
echo   На этом компьютере:  http://localhost:8000/
echo.
echo   С телефона (по Wi-Fi): http://IP_ЭТОГО_ПК:8000/
echo   Узнать IP компьютера:  в терминале выполните  ipconfig
echo                          (нужна строка "IPv4-адрес" в разделе адаптера Wi-Fi/Ethernet)
echo.
echo Чтобы остановить сервер, закройте это окно или нажмите Ctrl+C.
echo ----------------------------------------------------------------

start "" http://localhost:8000/
python -m http.server 8000 --bind 0.0.0.0
