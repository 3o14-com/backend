const LandingPage = () => {
  return (
    <div class="h-screen flex flex-col items-center justify-center">
      <h2 class="text-3xl">3o14</h2>

      <div class="mt-2 flex">
        <button class="btn btn-primary" hx-get="/auth/register" hx-push-url="true" hx-target=".container" type="submit">
          Register
        </button>
      </div>
      <div class="mt-2 flex">
        <button class="btn btn-primary" hx-get="/auth/login" hx-push-url="true" hx-target=".container" type="submit">
          Login
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
