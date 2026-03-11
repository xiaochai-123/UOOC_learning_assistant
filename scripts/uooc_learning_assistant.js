// Optimized UOOC Learning Assistant Script

// Function to auto-play videos with recursion and background compatibility
function playVideos() {
    const videos = document.querySelectorAll('video');
    let index = 0;

    function playNext() {
        // Check if tab is in focus
        if (document.hidden) {
            setTimeout(playNext, 1000); // Retry after a second if hidden
            return;
        }

        if (index < videos.length) {
            const video = videos[index];
            video.muted = true; // Auto-mute
            video.play().then(() => {
                // Continue to the next video when current ends
                video.onended = () => {
                    index++;
                    playNext();
                };
            }).catch((e) => {
                console.error('Error playing video:', e);
                index++; // Skip to next on failure
                playNext();
            });
        } else {
            // Reset index to loop
            index = 0;
            playNext();
        }
    }

    playNext(); // Start playing videos
}

// Function to adjust playback speed
function adjustPlaybackSpeed(speed) {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        video.playbackRate = speed;
    });
}

// Function to auto-answer quizzes
function autoAnswerQuizzes() {
    const quizzes = document.querySelectorAll('.quiz');
    quizzes.forEach(quiz => {
        const answers = quiz.querySelectorAll('.answer');
        if (answers.length > 0) {
            answers[0].click(); // Auto-select first answer
        }
    });
}

// Initialize script
document.addEventListener('DOMContentLoaded', () => {
    playVideos();
    adjustPlaybackSpeed(1.5); // Example speed adjustment
    autoAnswerQuizzes();
});