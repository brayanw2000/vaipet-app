import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		extend: {
			fontFamily: {
				'sans': ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', 'Inter', 'system-ui', 'sans-serif'],
				'display': ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', 'Inter', 'system-ui', 'sans-serif'],
				'mono': ['"SF Mono"', 'Monaco', 'Menlo', 'monospace'],
			},
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				// iOS Semantic-like colors
				surface: 'hsl(var(--surface))',
				'surface-elevated': 'hsl(var(--surface-elevated))',
				separator: 'hsl(var(--separator))',
				success: 'hsl(var(--success))',
				warning: 'hsl(var(--warning))',
				error: 'hsl(var(--error))',
				
				// VaiPet Brand
				'vaipet-green': '#31D880',
				'vaipet-dark': '#0B1410',
			},
			fontSize: {
				// iOS Dynamic Type Scale
				'ios-large-title': ['34px', { lineHeight: '41px', letterSpacing: '0.37px', fontWeight: '700' }],
				'ios-title-1': ['28px', { lineHeight: '34px', letterSpacing: '0.34px', fontWeight: '700' }],
				'ios-title-2': ['22px', { lineHeight: '28px', letterSpacing: '0.35px', fontWeight: '600' }],
				'ios-title-3': ['20px', { lineHeight: '25px', letterSpacing: '0.38px', fontWeight: '600' }],
				'ios-headline': ['17px', { lineHeight: '22px', letterSpacing: '-0.41px', fontWeight: '600' }],
				'ios-body': ['17px', { lineHeight: '22px', letterSpacing: '-0.41px', fontWeight: '400' }],
				'ios-callout': ['16px', { lineHeight: '21px', letterSpacing: '-0.32px', fontWeight: '400' }],
				'ios-subheadline': ['15px', { lineHeight: '20px', letterSpacing: '-0.24px', fontWeight: '400' }],
				'ios-footnote': ['13px', { lineHeight: '18px', letterSpacing: '-0.08px', fontWeight: '400' }],
				'ios-caption-1': ['12px', { lineHeight: '16px', letterSpacing: '0px', fontWeight: '400' }],
				'ios-caption-2': ['11px', { lineHeight: '13px', letterSpacing: '0.07px', fontWeight: '400' }],
			},
			spacing: {
				'4': '4px',
				'8': '8px',
				'12': '12px',
				'16': '16px',
				'20': '20px',
				'24': '24px',
				'32': '32px',
				'40': '40px',
				'48': '48px',
				'64': '64px',
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: { height: '0' },
					to: { height: 'var(--radix-accordion-content-height)' }
				},
				'accordion-up': {
					from: { height: 'var(--radix-accordion-content-height)' },
					to: { height: '0' }
				},
				'fade-in-up': {
					'0%': { opacity: '0', transform: 'translateY(16px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'fade-in': {
					'0%': { opacity: '0' },
					'100%': { opacity: '1' }
				},
				'scale-in': {
					'0%': { opacity: '0', transform: 'scale(0.95)' },
					'100%': { opacity: '1', transform: 'scale(1)' }
				},
				'slide-up': {
					'0%': { opacity: '0', transform: 'translateY(24px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'float': {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(-6px)' }
				},
				'shimmer': {
					'0%': { backgroundPosition: '-200% 0' },
					'100%': { backgroundPosition: '200% 0' }
				},
				'bounce-subtle': {
					'0%, 100%': { transform: 'translateY(0)' },
					'50%': { transform: 'translateY(-3px)' }
				},
				'pill-in': {
					'0%': { opacity: '0', transform: 'translate(-50%, 6px)' },
					'100%': { opacity: '1', transform: 'translate(-50%, 0)' }
				},
				'pill-content-in': {
					'0%': { opacity: '0', transform: 'translateY(4px)' },
					'100%': { opacity: '1', transform: 'translateY(0)' }
				},
				'splash-logo': {
					'0%, 100%': { transform: 'scale(1)', opacity: '1' },
					'50%': { transform: 'scale(1.06)', opacity: '0.92' },
				},
				'splash-ring': {
					'0%': { transform: 'scale(0.6)', opacity: '0.6' },
					'100%': { transform: 'scale(1.6)', opacity: '0' },
				},
				'splash-spin': {
					'0%': { transform: 'rotate(0deg)' },
					'100%': { transform: 'rotate(360deg)' },
				},
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
				'fade-in': 'fade-in 0.4s ease-out forwards',
				'scale-in': 'scale-in 0.4s ease-out forwards',
				'slide-up': 'slide-up 0.6s ease-out forwards',
				'float': 'float 3s ease-in-out infinite',
				'shimmer': 'shimmer 2s linear infinite',
				'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
				'pill-in': 'pill-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards',
				'pill-content-in': 'pill-content-in 0.35s ease-out forwards',
				'splash-logo': 'splash-logo 2s ease-in-out infinite',
				'splash-ring': 'splash-ring 1.8s ease-out infinite',
				'splash-spin': 'splash-spin 1.4s linear infinite',
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
