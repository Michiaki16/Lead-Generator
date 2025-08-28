// Enhanced email extraction utility functions
const emailUtils = {
  // Comprehensive email regex patterns
  emailPatterns: [
    // Standard email format
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    
    // Obfuscated emails with [at] and [dot]
    /[a-zA-Z0-9._%+-]+\s?\[at\]\s?[a-zA-Z0-9.-]+\s?\[dot\]\s?[a-zA-Z]{2,}/g,
    
    // Emails with "at" and "dot" words
    /[a-zA-Z0-9._%+-]+\s+at\s+[a-zA-Z0-9.-]+\s+dot\s+[a-zA-Z]{2,}/g,
    
    // Emails with HTML entities
    /[a-zA-Z0-9._%+-]+&#64;[a-zA-Z0-9.-]+&#46;[a-zA-Z]{2,}/g,
    
    // JavaScript obfuscated emails
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  ],

  // Enhanced email validation
  validateEmail: (email) => {
    const cleanEmail = email.toLowerCase().trim();
    
    // Basic format check
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) return false;
    if (cleanEmail.length < 5 || cleanEmail.length > 254) return false;
    
    // Invalid patterns to exclude
    const invalidPatterns = [
      'noreply', 'no-reply', 'donotreply', 'do-not-reply',
      'example.com', 'test@', 'sample@', 'placeholder',
      'your-email', 'youremail', 'email@domain', 'name@domain',
      'user@example', 'admin@localhost', 'test@test',
      '@example.', '@test.', '@demo.', '@sample.',
      'webmaster@', 'postmaster@', 'mailer-daemon@'
    ];
    
    // Business-like patterns to prioritize
    const businessPatterns = [
      'info@', 'contact@', 'hello@', 'support@', 
      'sales@', 'inquiry@', 'business@', 'office@',
      'admin@', 'manager@', 'director@', 'ceo@',
      'owner@', 'team@'
    ];
    
    // Check for invalid patterns
    for (const pattern of invalidPatterns) {
      if (cleanEmail.includes(pattern)) return false;
    }
    
    // Assign priority score
    let priority = 1;
    for (const pattern of businessPatterns) {
      if (cleanEmail.includes(pattern)) {
        priority = 3;
        break;
      }
    }
    
    return { isValid: true, priority, email: cleanEmail };
  },

  // Clean and normalize email addresses
  normalizeEmail: (email) => {
    return email
      .replace(/\[at\]/gi, '@')
      .replace(/\[dot\]/gi, '.')
      .replace(/\sat\s/gi, '@')
      .replace(/\sdot\s/gi, '.')
      .replace(/&#64;/g, '@')
      .replace(/&#46;/g, '.')
      .toLowerCase()
      .trim();
  }
};

module.exports = emailUtils;