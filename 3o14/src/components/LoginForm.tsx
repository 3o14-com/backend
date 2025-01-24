import { clsx } from "clsx"

export type LoginFormErrors = Record<string, { message: string }>;

export interface LoginFormProps {
  email?: string,
  password?: string,
  errors?: LoginFormErrors,
}

export function LoginForm(props: LoginFormProps) {
  return (
    <div>
      <h2 class="card-title">Login</h2>
      <form hx-post="/auth/login" hx-target="closest div" hx-swap="outerHTML">
        <div class="form-control w-full max-w-xs">
          <label class="label" for="email">
            <span class="label-text">Email</span>
          </label>
          <input
            type="email"
            placeholder="enter your email"
            id="email"
            name="email"
            value={props.email}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.email,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.email && props.errors.email.message}
          </p>
        </div>


        <div class="form-control w-full max-w-xs">
          <label class="label" for="password">
            <span class="label-text">Password</span>
          </label>
          <input
            type="password"
            placeholder="enter your password"
            id="password"
            name="password"
            value={props.password}
            class={clsx('input input-bordered w-full max-w-xs', {
              'input-error': props.errors?.password,
            })}
            required
          />
          <p safe class="m-2 text-error h-4">
            {props.errors?.password && props.errors.password.message}
          </p>
        </div>


        <div class="mt-2 flex">
          <button class="btn btn-primary" type="submit">
            Login
          </button>
        </div>
      </form>
    </div>
  )
}
