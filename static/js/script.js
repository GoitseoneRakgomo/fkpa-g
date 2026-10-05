document.querySelectorAll('.serve-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.getAttribute('data-target');
        const panel = document.getElementById(target);

        // remove active
        document.querySelectorAll('.serve-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.serve-panel').forEach(p => p.classList.remove('active'));

        // activate clicked
        tab.classList.add('active');
        panel.classList.add('active');

        // 🔥 smooth horizontal scroll to card
        panel.scrollIntoView({
            behavior: 'smooth',
            inline: 'center',
            block: 'nearest'
        });
    });
});

// FAQ Accordion Logic
document.querySelectorAll('.faq-question').forEach(question => {
    question.addEventListener('click', () => {
        const currentItem = question.parentElement;
        const isActive = currentItem.classList.contains('active');

        // Close all FAQ items
        document.querySelectorAll('.faq-item').forEach(item => {
            item.classList.remove('active');
        });

        // Open the clicked one if it wasn't already open
        if (!isActive) {
            currentItem.classList.add('active');
        }
    });
});

// Document Upload Display Logic
const fileInput = document.getElementById('idUpload');
const fileDisplay = document.querySelector('.file-name-display');

if (fileInput && fileDisplay) {
    fileInput.addEventListener('change', function() {
        if (this.files && this.files.length > 1) {
            // Multiple files selected
            fileDisplay.textContent = this.files.length + ' documents securely attached';
            fileDisplay.style.color = 'var(--gold-primary)';
        } else if (this.files && this.files.length === 1) {
            // Single file selected
            fileDisplay.textContent = this.files[0].name;
            fileDisplay.style.color = 'var(--gold-primary)';
        } else {
            // Reset to default if cleared
            fileDisplay.textContent = 'Click to browse or drag & drop documents';
            fileDisplay.style.color = 'rgba(255,255,255,0.85)';
        }
    });
}

document.addEventListener("DOMContentLoaded", function() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('nav ul li a');

    if (hamburger && navMenu) {
        // Toggle menu open/close on click
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
            
            // Prevent body scrolling when menu is open
            if (hamburger.classList.contains('active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = 'auto';
            }
        });

        // Close menu when any link is clicked
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = 'auto';
            });
        });
    }
});