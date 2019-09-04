import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';

class Response extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            inputs: [''],
            output: null,
        };
    }
    
    send = (event) => {
        console.log('send data:');
        console.log(this.state);
        axios.post(`http://localhost:3001/bcr/update`, this.state);
    }
    
    handleTextChange = (event, name, i) => {
        const data = this.state[name].slice();
        data[i] = event.target.value;
        this.setState({[name]: data});
        console.log(name, this.state[name][i]);
    };
    
    render() {
        return (
            <div>
                <Inputs
                    onChange={(event, i) => this.handleTextChange(event, 'inputs', i)}
                    inputs={this.state.inputs}
                ></Inputs>
                <Outputs onChange={(event) => this.handleTextChange(event, 'output')}></Outputs>
                <Options></Options>
                <SaveButton onClick={this.send}></SaveButton>
            </div>
        );
    }
}


class Input extends React.Component {
    render() {
        return (
            <input type="text" onInput={this.props.onChange}></input>
        )
    }
}
    
class Inputs extends React.Component {
    render() {
        return (
            <div>
                {Object.keys(this.props.inputs).map((_, i) => 
                    <Input onChange={(event) => this.props.onChange(event, i)}></Input>
                )
                // TODO: add button
                }
            </div>
        );
    }
}
        
class Outputs extends React.Component {
    render() {
        return (
            <div>
                <textarea onChange={this.props.onChange}></textarea>
            </div>
        );
    }
}
            
class Options extends React.Component {
    render() {
        return (
            <div>
                <Option></Option>
            </div>
        );
    }
}
                
class Option extends React.Component {
    render() {
        return (
            <input type="checkbox" ></input>
        );
    }
}
                    
class SaveButton extends React.Component {
    render() {
        return (
            <button onClick={this.props.onClick}>save</button>
        );
    }
}
                        
const App = () => {
    return (
        <div>
            <header>
                <p>カスタムレスポンス</p>
            </header>
            <Response></Response>
        </div>
    );
}
                            
ReactDOM.render(<App />, document.getElementById('root'));
                            
                            