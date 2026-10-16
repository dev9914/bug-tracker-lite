import mongoose from 'mongoose';

/** Fail fast instead of hanging when the cluster is unreachable. */
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

export async function connectDatabase(uri: string | undefined = process.env.MONGODB_URI): Promise<void> {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Add it to backend/.env before starting the server.');
  }

  // Log connection problems without ever echoing the URI (it contains credentials).
  mongoose.connection.on('error', (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`MongoDB connection error: ${reason}`);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected');
  });

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to connect to MongoDB: ${reason}`, { cause: error });
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
