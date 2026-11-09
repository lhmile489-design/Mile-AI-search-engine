package main

import (
	"log"
	"os"
	"runtime"
	"time"

	"github.com/egoist/mygo"

	"github.com/lhmile489-design/mile-ai-search/spike"
)

// Greeter is callable from the frontend: `mygo generate` turns its methods
// into typed TypeScript functions in src/mygo.ts.
type Greeter struct{}

// Greet returns a greeting for name.
func (Greeter) Greet(name string) string {
	if name == "" {
		name = "stranger"
	}
	return "Hello, " + name + "! This message comes from Go."
}

// SystemInfo describes the machine the app runs on.
type SystemInfo struct {
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
}

// Info returns information about the system.
func (Greeter) Info() SystemInfo {
	return SystemInfo{OS: runtime.GOOS, Arch: runtime.GOARCH, GoVersion: runtime.Version()}
}

// Tick is sent to the page every second.
var Tick = mygo.NewEvent[time.Time]("tick")

func main() {
	mygo.Bind(Greeter{})

	// G1 spike: bound only when MYGO_SPIKE is set, to keep the shipping window
	// and generated client free of probe methods. Remove before G2.
	spikeMode := os.Getenv("MYGO_SPIKE") != ""
	if spikeMode {
		mygo.Bind(spike.Spike{})
	}

	mygo.App.WhenReady(func() {
		// Probes only run when MYGO_PROBE names one; plain MYGO_SPIKE keeps the
		// shipping "/" page (now React) so bindings like Spike.Report resolve.
		probe := os.Getenv("MYGO_PROBE")
		url := "/"
		if spikeMode && probe != "" {
			url = "/spike.html?auto&probe=" + probe
		}
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "Mile AI Search",
			Width:           960,
			Height:          640,
			MinWidth:        480,
			MinHeight:       360,
			BackgroundColor: "light-dark(#f6f7f9, #0f1115)", // the page's --bg in src/style.css
			// Opens where the user left it last time.
			StateKey: "main",
			// The frontend: devUrl during `mygo dev`, frontendDist
			// embedded by `mygo build` otherwise (see mygo.json).
			URL: url,
		})
		if spikeMode && probe != "" {
			return // no Tick demo during probes
		}
		go func() {
			for t := range time.Tick(time.Second) {
				if Tick.Emit(win, t) != nil {
					return // the window was closed
				}
			}
		}()
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
