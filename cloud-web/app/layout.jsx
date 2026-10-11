import './style.css';

export const metadata = {
  title: 'Synth Studio Cloud',
  description: 'On-demand image and text processing',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
