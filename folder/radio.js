const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// Конфигурация
const PORT = 5000;
const MUSIC_FOLDER = 'music'; // Папка с музыкой
const AUDIO_FILES = fs.readdirSync(MUSIC_FOLDER).filter(file => file.endsWith('.mp3')); // Получаем список mp3 файлов
let currentTrack = null; // Текущий трек

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let isPlaying = false;
let currentPosition = 0; // Позиция воспроизведения (в секундах)
let volume = 100; // Начальная громкость (0-100)
let audioStreamProcess = null;
let syncInterval = null; // Интервал для синхронизации

// HTML-шаблон
const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Синхронизированное Радио</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            background-color: black; /* Начальный черный фон */
            color: white;
            margin: 0;
            padding: 0;
            transition: background-color 2s; /* Плавный переход фона */
        }
        h1 {
            margin-top: 50px;
        }
        audio {
            margin-top: 20px;
            width: 80%;
            display: none; /* Скрываем элементы управления аудио */
        }
        button {
    margin-top: 20px;
    padding: 15px 25px;
    font-size: 18px;
    background-color: rgba(0, 0, 0, 0.7); /* Черный цвет с 70% прозрачностью */
    border: none;
    border-radius: 5px;
    cursor: pointer;
    color: white; /* Белый текст */
    transition: background-color 0.3s ease; /* Плавный переход цвета фона */
}

button:hover {
    background-color: rgba(0, 0, 0, 0.9); /* При наведении кнопка становится более темной */
}
        .track-info {
            margin-top: 20px;
            font-size: 30px;
            font-weight: bold;
        }
        .online-count {
            position: absolute;
            top: 20px;
            left: 20px;
            font-size: 20px;
            color: white;
            font-weight: bold;
        }   
    </style>
</head>
<body>
    <h1>Радио</h1>
    <audio id="radio" controls>
        <source src="/stream" type="audio/mp3">
        Ваш браузер не поддерживает аудио.
    </audio>

    <button id="startButton">Начать воспроизведение</button>

    <div class="track-info" id="trackInfo">
        Трек: <span id="trackName">Не выбран</span><br> - <span id="trackTime">0</span>
    </div>
    <div class="online-count" id="onlineCount">
        В сети: 0
    </div>

    <script src="https://cdn.socket.io/4.0.1/socket.io.min.js"></script>
    <script>
    const socket = io();
    const radioElement = document.getElementById('radio');
    const startButton = document.getElementById('startButton');
    const trackNameElement = document.getElementById('trackName');
    const trackTimeElement = document.getElementById('trackTime');
    const onlineCountElement = document.getElementById('onlineCount');

    // Функция для генерации случайного цвета
    function getRandomColor() {
        const letters = '0123456789ABCDEF';
        let color = '#';
        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }
        return color;
    }

    // Получаем обновления по количеству подключенных пользователей
    socket.on('update_online_count', function(data) {
        onlineCountElement.textContent = 'В сети: ' + data.count;
    });

    // Слушаем событие для начала воспроизведения
    startButton.addEventListener('click', () => {
        socket.emit('start_music');
        startButton.disabled = true; // Делаем кнопку неактивной после нажатия
        radioElement.play();
    });


    socket.on('connect', () => {
        console.log('Подключено к серверу!');
    });

    socket.on('update_position', function(data) {
        console.log('Текущая позиция:', data.position);
        radioElement.currentTime = data.position;  // Перемещаем позицию воспроизведения
        const minutes = Math.floor(data.position / 60);
        const seconds = data.position % 60;
        trackTimeElement.textContent = minutes + ":" + seconds; // Обновляем количество секунд на клиенте
    });

    socket.on('update_track', function(data) {
        trackNameElement.textContent = data.trackName; // Обновляем название трека на клиенте
    });

    // Когда трек завершен, перезагружаем страницу и начинаем новый трек
    socket.on('track_ended', function() {
        console.log('Трек завершен, обновляем страницу');
        location.reload();  // Перезагружаем страницу
    });
    function isMobile() {
       return /Mobi|Android/i.test(navigator.userAgent);
    }
    window.onload = function() { 
        document.body.style.backgroundColor = getRandomColor();
        if (!isMobile()) {
            startButton.click();
        };
    };

    </script>

</body>
</html>
`;

// Старт сервера
app.get('/', (req, res) => {
    res.send(htmlTemplate);
});

// Стрим аудио
app.get('/stream', (req, res) => {
    res.set({
        'Content-Type': 'audio/mp3',
        'Transfer-Encoding': 'chunked',
    });

    // Если текущий трек не выбран, выбираем случайный
    if (!currentTrack) {
        currentTrack = AUDIO_FILES[Math.floor(Math.random() * AUDIO_FILES.length)];
        // Отправляем название трека всем подключенным клиентам
        io.emit('update_track', { trackName: currentTrack });
    }

    audioStreamProcess = spawn('ffmpeg', [
        '-i', path.join(MUSIC_FOLDER, currentTrack),
        '-f', 'mp3',
        '-vn',
        '-b:a', '128k',
        'pipe:1'
    ]);

    audioStreamProcess.stdout.pipe(res);
    audioStreamProcess.stderr.on('data', (data) => {
        console.error(`FFmpeg ошибка: ${data}`);
    });

    req.on('close', () => {
        audioStreamProcess.kill();
    });
});

// Событие подключения клиентов через Socket.IO
let clients = [];

let onlineCount = 0;  // Счетчик подключенных пользователей

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    onlineCount++;
    clients.push(socket);
    io.emit('update_online_count', { count: onlineCount });  // Отправляем обновленный счетчик всем клиентам

    // Отправить начальную позицию (0) при подключении
    socket.emit('update_position', { position: 0 });

    // Отправить текущий трек
    socket.emit('update_track', { trackName: currentTrack });

    // Обработка отключения клиента
    socket.on('disconnect', () => {
        console.log('Отключение клиента:', socket.id);
        clients = clients.filter(client => client.id !== socket.id);
        onlineCount--;  // Уменьшаем счетчик при отключении
        io.emit('update_online_count', { count: onlineCount });  // Отправляем обновленный счетчик всем клиентам
    });

    // Слушаем запрос на начало воспроизведения
    socket.on('start_music', () => {
        isPlaying = true;
        console.log('Музыка начнёт играть');
        startStreaming();
    });
});


function startStreaming() {
    if (syncInterval) return;  // Если синхронизация уже запущена, не запускаем её повторно

    syncInterval = setInterval(() => {
        if (isPlaying) {
            // Обновляем позицию воспроизведения каждый раз на сервере
            currentPosition += 1;  // Позиция увеличивается на 1 каждую секунду

            // Если позиция достигла конца аудио, сбрасываем её в 0 и выбираем новый случайный трек
            if (currentPosition >= 100) {
                currentPosition = 0;
                currentTrack = AUDIO_FILES[Math.floor(Math.random() * AUDIO_FILES.length)]; // Новый случайный трек
                console.log('Трек завершен, переключаемся на новый:', currentTrack);

                // Отправляем название нового трека всем клиентам
                io.emit('update_track', { trackName: currentTrack });

                // Отправляем команду клиентам для обновления страницы
                io.emit('track_ended'); // Новый трек завершен, нужно обновить страницу

                // Останавливаем текущий поток
                if (audioStreamProcess) {
                    audioStreamProcess.kill();  // Завершаем старый поток
                    audioStreamProcess = null;  // Очищаем ссылку
                }

                // Стартуем новый поток для нового трека
                audioStreamProcess = spawn('ffmpeg', [
                    '-i', path.join(MUSIC_FOLDER, currentTrack),
                    '-f', 'mp3',
                    '-vn',
                    '-b:a', '128k',
                    'pipe:1'
                ]);

                // Слушаем новый поток и передаем данные клиентам
                audioStreamProcess.stdout.on('data', (chunk) => {
                    // Отправляем данные на все клиентские подключения
                    clients.forEach(client => {
                        client.emit('audio_chunk', chunk);
                    });
                });

                audioStreamProcess.stderr.on('data', (data) => {
                    console.error(`FFmpeg ошибка: ${data}`);
                });

                audioStreamProcess.on('close', () => {
                    console.log('FFmpeg поток завершен');
                });
            }

            // Отправляем обновленную позицию всем подключенным клиентам
            clients.forEach(client => {
                client.emit('update_position', { position: currentPosition });
            });
        }
    }, 1000); // Синхронизация раз в секунду
}



// Запуск сервера
server.listen(PORT, () => {
    console.log(`Радио-сервер запущен на http://localhost:${PORT}`);
});
