# ParkEase - AI-Powered Smart Parking Platform

An intelligent parking space prediction and booking system that helps users find and reserve parking spots in advance using AI/ML predictions.

## Features

- 🚗 Real-time parking space search with map integration
- 🤖 AI-powered availability prediction (15-60 minutes ahead)
- 📱 Mobile-first responsive design
- 🔒 Secure authentication & authorization
- 💳 Integrated payment processing
- 📊 Admin dashboard for parking management
- 🔔 Real-time updates via WebSockets

## Tech Stack

- **Frontend**: React.js, Tailwind CSS, Google Maps API
- **Backend**: Node.js, Express.js, Socket.io
- **Database**: MongoDB, Redis (caching)
- **AI/ML**: Python, Flask, Scikit-learn/TensorFlow
- **Deployment**: Docker, AWS/GCP

## Prerequisites

- Node.js 18+
- Python 3.10+
- Docker & Docker Compose
- MongoDB
- Redis

## Getting Started

### Development (Docker)

```bash
# Clone the repository
git clone <repository-url>
cd parkease-ai

# Start all services
docker-compose up --build
```

### Development (Local)

#### Backend
```bash
cd backend
npm install
npm run dev
```

#### Frontend
```bash
cd frontend
npm install
npm run dev
```

#### ML Service
```bash
cd ml-service
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Environment Variables

Create `.env` files in each service directory with appropriate values. See `.env.example` files for reference.

## API Documentation

API documentation is available at `/api-docs` when running the backend service.

## License

MIT
