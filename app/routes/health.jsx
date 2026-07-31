import db from "../db.server";

export const loader = async () => {
  try {
    // Simple query to ensure the database connection to RDS is alive
    await db.$queryRaw`SELECT 1`;
    
    // Return a 200 OK so the AWS ALB knows the container is healthy
    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  } catch (error) {
    console.error("Health check failed:", error);
    // Return a 503 if the DB is unreachable, prompting the ALB to route traffic away
    return new Response("ERROR", {
      status: 503,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }
};
