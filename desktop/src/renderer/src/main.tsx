import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { Island } from "./island"
import "./index.css"
import "./island.css"

const isIsland = location.hash === "#island"
if (isIsland) document.documentElement.classList.add("island-document")
createRoot(document.getElementById("root")!).render(<StrictMode>{isIsland ? <Island /> : <App />}</StrictMode>)
