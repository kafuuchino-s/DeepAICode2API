/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: {
    background: 'hsl(var(--background) / <alpha-value>)',
    foreground: 'hsl(var(--foreground) / <alpha-value>)',
    card: 'hsl(var(--card) / <alpha-value>)',
    'card-foreground': 'hsl(var(--card-foreground) / <alpha-value>)',
    primary: 'hsl(var(--primary) / <alpha-value>)',
    'primary-foreground': 'hsl(var(--primary-foreground) / <alpha-value>)',
    secondary: 'hsl(var(--secondary) / <alpha-value>)',
    'secondary-foreground': 'hsl(var(--secondary-foreground) / <alpha-value>)',
    muted: 'hsl(var(--muted) / <alpha-value>)',
    'muted-foreground': 'hsl(var(--muted-foreground) / <alpha-value>)',
    border: 'hsl(var(--border) / <alpha-value>)',
    input: 'hsl(var(--input) / <alpha-value>)',
    ring: 'hsl(var(--ring) / <alpha-value>)',
    destructive: 'hsl(var(--destructive) / <alpha-value>)',
    'destructive-foreground': 'hsl(var(--destructive-foreground) / <alpha-value>)',
  }, borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' } } },
  plugins: [],
};
