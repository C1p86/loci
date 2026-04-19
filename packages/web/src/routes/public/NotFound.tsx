import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 py-16">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found</p>
      <Button asChild variant="outline">
        <Link to="/">Go home</Link>
      </Button>
    </div>
  );
}
