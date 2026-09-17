import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import Home from '../page';

// Mock do next/link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => {
    return <a href={href}>{children}</a>;
  };
});

describe('Home Page', () => {
  it('renders a heading', () => {
    render(<Home />);
    
    const heading = screen.getByText('PeliDev');
    expect(heading).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<Home />);
    
    const receiverLink = screen.getByText('Abrir Receptor (PC/Mac)');
    expect(receiverLink).toBeInTheDocument();
    
    const transmitterLink = screen.getByText('Transmitir via Navegador');
    expect(transmitterLink).toBeInTheDocument();
  });
});
