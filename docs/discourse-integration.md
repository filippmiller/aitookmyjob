# Discourse Forum Integration Guide

This guide explains how to integrate Discourse, the leading open-source forum software, with the AI Took My Job platform.

## Why Discourse?

Discourse is chosen because it's:
- Free and open-source
- Highly customizable
- Mobile-responsive
- Feature-rich with modern UX
- Well-maintained with active community
- Scalable for growing communities

## Integration Steps

### 1. Deploy Discourse

The recommended approach is using Docker:

```bash
git clone https://github.com/discourse/discourse_docker.git
cd discourse_docker
./launcher bootstrap app
./launcher start app
```

### 2. Configuration

Edit your Discourse configuration (`containers/app.yml`) to include:

```yml
hooks:
  after_code:
    - exec:
        cd: $home/plugins
        cmd:
          - git clone https://github.com/discourse/docker_manager.git
```

### 3. Single Sign-On (SSO) Setup

To integrate with your existing user system:

1. Enable SSO in Discourse admin panel
2. Generate a secret key for SSO
3. Configure your main application to generate SSO payloads
4. Set the SSO URL to your main app's SSO endpoint

### 4. Theme Customization

To match the glassmorphism design of the main site:

1. Create a custom theme in Discourse admin
2. Add CSS overrides to match the glassmorphism aesthetic:
   ```css
   .docked .title-wrapper, .docked .panel, .docked .extra-info-wrapper {
     background: rgba(255, 255, 255, 0.2) !important;
     backdrop-filter: blur(12px) !important;
     border: 1px solid rgba(255, 255, 255, 0.3) !important;
   }
   ```

### 5. Category Setup

Create initial categories that align with your community needs:
- General Discussion
- Developers & QA
- Designers & Artists
- Legal Rights
- Reskilling & Career Change
- Success Stories

### 6. API Integration

If you need to pull forum data to display on the main site:

```javascript
// Example API call to Discourse
const fetchDiscourseData = async () => {
  const response = await fetch('https://your-discourse-url/latest.json');
  return await response.json();
};
```

## Environment Variables

Add to your `.env` file:
```
DISCOURSE_URL=https://your-discourse-domain.com
DISCOURSE_API_KEY=your_api_key
DISCOURSE_API_USERNAME=system
```

## Docker Compose Example

For easier deployment alongside your main application:

```yaml
version: '3.8'

services:
  discourse:
    image: discourse/discourse:latest
    ports:
      - "4000:3000"
    environment:
      - DISCOURSE_HOST=localhost
      - DISCOURSE_DEVELOPER_EMAILS=admin@example.com
      - DISCOURSE_SMTP_HOST=smtp.example.com
      - DISCOURSE_SMTP_PASSWORD=password
    volumes:
      - ./data:/shared
    depends_on:
      - db
      - redis

  db:
    image: postgres:13
    environment:
      - POSTGRES_DB=discourse
      - POSTGRES_USER=discourse
      - POSTGRES_PASSWORD=password
    volumes:
      - ./postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:6
    volumes:
      - ./redis_data:/data
```

## SSO Implementation Example (Node.js)

```javascript
const crypto = require('crypto');

function discourseSso(payload, secret) {
  const base64Payload = Buffer.from(payload).toString('base64');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(base64Payload)
    .digest('hex');
  
  return {
    sso: base64Payload,
    sig: signature
  };
}

// Usage in route
app.get('/discourse/sso', (req, res) => {
  if (!req.user) {
    return res.redirect('/login');
  }
  
  const payload = `nonce=abc123&return_sso_url=${encodeURIComponent('https://yoursite.com/discourse/sso/callback')}`;
  const ssoData = discourseSso(payload, process.env.DISCOURSE_SSO_SECRET);
  
  res.redirect(`https://discourse.yoursite.com/session/sso_provider?sso=${encodeURIComponent(ssoData.sso)}&sig=${ssoData.sig}`);
});
```

## Migration Path

If you have existing forum data:
1. Export data from current system
2. Transform to Discourse-compatible format
3. Use Discourse's import tools or API
4. Test thoroughly before going live

## Monitoring and Maintenance

- Regular backups of Discourse data
- Monitor performance and scale as needed
- Keep Discourse updated to latest stable version
- Moderate content regularly
- Engage with community to encourage participation