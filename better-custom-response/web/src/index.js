import React from 'react';
import ReactDOM from 'react-dom';
import axios from 'axios';
import {ulid} from 'ulid';

const apiURLPrefix = 'http://localhost:3001/bcr';

class TextBoxContent {
  constructor(text=null) {
    this.id = ulid();
    this.text = text;
  }
}

class Response extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      id: this.props.id,
      inputs: [new TextBoxContent()],
      outputs: [new TextBoxContent()],
    };
  }
    
  send = (event) => {
    console.log('send data:');
    console.log(this.state);
    axios.post(`${apiURLPrefix}/update`, this.state);
  }
  
  handleTextChange = (event, name, i) => {
    const data = this.state[name].slice();
    data[i].text = event.target.value;
    this.setState({[name]: data});
    console.log(name, this.state[name][i].text);
  };

  handleAddButtonClick = (event, name) => {
    const data = this.state[name].slice();
    data.push(new TextBoxContent());
    this.setState({[name]: data});
  }

  handleDeleteButtonClick =  (event, name, id) => {
    const newData = this.state[name].filter(({id: id2}) => id2 !== id);
    console.log(newData);
    this.setState({[name]: newData});
  }

  componentDidMount = () => {
    if (this.props.initialResponse) {
      this.setState(this.props.initialResponse);
    }
  }
  
  render() {
    return (
      <div>
        <TextBoxes
          contentClass={Input}
          onChange={(event, i) => this.handleTextChange(event, 'inputs', i)}
          values={this.state.inputs}
          onAddButtonClick={(event) => this.handleAddButtonClick(event, 'inputs')}
          onDeleteButtonClick={(event, id) => this.handleDeleteButtonClick(event, 'inputs', id)}
        ></TextBoxes>
        <TextBoxes
          contentClass={Output}
          onChange={(event, i) => this.handleTextChange(event, 'outputs', i)}
          values={this.state.outputs}
          onAddButtonClick={(event) => this.handleAddButtonClick(event, 'outputs')}
          onDeleteButtonClick={(event, id) => this.handleDeleteButtonClick(event, 'outputs', id)}
        ></TextBoxes>
        <Options></Options>
        <SaveButton onClick={this.send}></SaveButton>
      </div>
    );
  }
}

class Input extends React.Component {
  render() {
    return (
      <li>
        <input type="text" onInput={this.props.onChange} defaultValue={this.props.value.text}></input>
      </li>
    )
  }
}

class Output extends React.Component {
  render() {
    return (
      <li>
        <textarea onChange={this.props.onChange} defaultValue={this.props.value.text}></textarea>
      </li>
    );
  }
}

class AddButton extends React.Component {
  render() {
    return (
      <button onClick={this.props.onClick}>Add</button>
    );
  }
}

class DeleteButton extends React.Component {
  render() {
    return (
      <button onClick={this.props.onClick}>Delete</button>
    );
  }
}

class TextBoxes extends React.Component {
  render() {
    return (
      <div>
        <ul>
          {
            this.props.values.map((value, i) =>
              <div>
                <this.props.contentClass
                  key={value.id}
                  onChange={
                    (event) => this.props.onChange(event, i)
                  }
                  value={value}
                />
                <DeleteButton onClick={(event) => this.props.onDeleteButtonClick(event, value.id)}></DeleteButton>
              </div>
            )
          }
        </ul>
        <AddButton onClick={this.props.onAddButtonClick} />
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

class Responses extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      responseIDs: [],
      initialResponses: null,
    };
  }

  componentDidMount = async () => {
    const responses = (await axios.get(`${apiURLPrefix}/list`, this.state)).data;
    console.log(responses);
    if (responses.length === 0) {
      this.setState({responseIDs: [ulid()], initialResponses: new Map()});
    } else {
      this.setState({
        responseIDs: responses.map(({id}) => id),
        initialResponses: new Map(responses.map(r => [r.id, r])),
      });
    }
  }

  handleAddButtonClick = (event) => {
    const responseIDs = this.state.responseIDs;
    responseIDs.push(ulid());
    this.setState({responseIDs: responseIDs});
  }
  
  render() {
    return (
      <div>
        {this.state.responseIDs.map(
          (id, i) => 
            <Response
              key={id}
              id={id}
              initialResponse={this.state.initialResponses.get(id)}
              onClick={this.handleAddButtonClick}
            ></Response>
        )}
        <AddButton onClick={this.handleAddButtonClick}></AddButton>
      </div>
    );
  }
}

class App extends React.Component {

  render() {
    return (
      <div>
        <header>
          <p>カスタムレスポンス</p>
        </header>
        <Responses></Responses>
      </div>
    );
  }
}
                            
ReactDOM.render(<App />, document.getElementById('root'));
                            
                            