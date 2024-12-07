const ffmpeg = require('fluent-ffmpeg');

// Проверяем, установлен ли FFmpeg
ffmpeg.getAvailableEncoders((err, encoders) => {
    if (err) {
        console.error('FFmpeg не установлен или не настроен.');
        process.exit(1); // Завершаем выполнение
    } else {
        console.log('FFmpeg установлен, доступные кодеки:', encoders);
    }
});
